import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { sendNewsletterEmail, sendNewsletterBatch, recordEmailFailure } from '@/lib/email'
import { buildWeeklyDigest } from '@/lib/newsletterDigest'
import { writeAudit } from '@/lib/audit'
import { sanitizeNewsletter } from '@/lib/sanitize'
import { firstNameOf } from '@/lib/data'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { resolveCityId, getCityTz } from '@/lib/city'
import { fromWallClockInTz } from '@/lib/cityTime'

export const dynamic = 'force-dynamic'

type Segment = 'all' | 'new' | 'active' | 'inactive'
const SEGMENTS: Segment[] = ['all', 'new', 'active', 'inactive']

// Same shape the broadcast route takes: one id per composed newsletter,
// sent with every attempt at it.
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/
// What a datetime-local input sends: the wall clock, no zone.
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
// A full instant with its zone written in (API callers, scripts): nothing
// to interpret, so it is taken as-is.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

// A timezone the client says it showed the schedule picker in. Anything
// Intl can't resolve is refused rather than guessed at.
function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

const BASE_WHERE = { emailMarketing: true, emailVerified: true, status: 'approved' } as const

function recipientWhere(segment: Segment, cityId?: string) {
  const now = new Date()
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000)
  // A city id narrows any segment to that city's members — the only way to
  // send "just Bodrum" until the auto weekly digest becomes per-city.
  const city = cityId ? { cityId } : {}
  switch (segment) {
    case 'new':
      return { ...BASE_WHERE, ...city, joinedAt: { gte: days(60) } }
    case 'active':
      return { ...BASE_WHERE, ...city, joinedEvents: { some: { status: 'approved', joinedAt: { gte: days(90) } } } }
    case 'inactive':
      return { ...BASE_WHERE, ...city, joinedEvents: { none: { status: 'approved', joinedAt: { gte: days(180) } } } }
    default:
      return { ...BASE_WHERE, ...city }
  }
}

// GET /api/admin/newsletter — history + segment counts + sample recipients
//
// `?cityId=` narrows the counts and samples to the city a send would be
// scoped to. They used to be network-wide whatever the picker said, so the
// button read "Send to 1,234 members" while only Bodrum's 40 would get it.
// `?scope=counts` skips the history, for the refetch when the city changes.
// `?newMembers=1` answers the "New members" insert instead (see below).
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const params    = req.nextUrl.searchParams
  const rawCityId = params.get('cityId')?.trim() || null
  let cityId: string | undefined
  if (rawCityId) {
    const c = await prisma.city.findUnique({ where: { id: rawCityId }, select: { id: true } })
    if (!c) return NextResponse.json({ error: 'Unknown city' }, { status: 400 })
    cityId = c.id
  }

  // First names of the last week's joiners, for the "New members" insert.
  // It read /api/members, which lists the admin's VIEW city, so a Bodrum
  // issue welcomed Istanbul's new members. Same visibility as the
  // directory: approved, not admin-hidden. No city picked → the view city,
  // which is what the insert has always used for an all-cities issue.
  if (params.get('newMembers') === '1') {
    const scopeCityId = cityId ?? await resolveCityId(session)
    const fresh = await prisma.user.findMany({
      where: {
        cityId: scopeCityId, status: 'approved', hiddenFromMembers: false,
        role: { in: ['member', 'moderator', 'admin'] },
        joinedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
      select:  { name: true },
      orderBy: { joinedAt: 'desc' },
      take:    200,
    })
    return NextResponse.json({ names: fresh.map(u => firstNameOf(u.name)) })
  }

  // Counts and a few sample names per segment, each within the city scope.
  // The samples used to be the five newest opted-in members anywhere, so
  // "Includes: …" named people the send would never reach.
  const perSegment = await Promise.all(SEGMENTS.map(async seg => {
    const where = recipientWhere(seg, cityId)
    const [count, sample] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, select: { name: true }, take: 3, orderBy: { joinedAt: 'desc' } }),
    ])
    return [seg, { count, sample: sample.map(u => firstNameOf(u.name)) }] as const
  }))
  const segmentCounts    = Object.fromEntries(perSegment.map(([seg, v]) => [seg, v.count])) as Record<Segment, number>
  const sampleRecipients = Object.fromEntries(perSegment.map(([seg, v]) => [seg, v.sample])) as Record<Segment, string[]>

  if (params.get('scope') === 'counts') {
    return NextResponse.json({ segmentCounts, sampleRecipients })
  }

  const [autoSetting, newsletters] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: 'autoWeeklyNewsletter' } }),
    prisma.newsletter.findMany({
      orderBy: { sentAt: 'desc' },
      take: 50,
      include: { sentBy: { select: { name: true } } },
    }),
  ])

  return NextResponse.json({
    autoWeekly: autoSetting?.value === 'on',
    newsletters: newsletters.map(n => ({
      id:               n.id,
      subject:          n.subject,
      bodyHtml:         n.bodyHtml,
      segment:          n.segment,
      status:           n.status,
      scheduledFor:     n.scheduledFor,
      recipientCount:   n.recipientCount,
      openCount:        n.openCount,
      clickCount:       n.clickCount,
      unsubscribeCount: n.unsubscribeCount,
      sentAt:           n.sentAt,
      sentBy:           n.sentBy,
    })),
    segmentCounts,
    sampleRecipients,
  })
}

// POST /api/admin/newsletter — send to opted-in members (optionally filtered by segment)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body         = await req.json().catch(() => null)
  const subject      = typeof body?.subject  === 'string' ? body.subject.trim().slice(0, 200) : ''
  const bodyHtml     = typeof body?.bodyHtml === 'string' ? body.bodyHtml.trim() : ''
  const segment: Segment = ['all', 'new', 'active', 'inactive'].includes(body?.segment)
    ? body.segment : 'all'
  // Optional city scope on a manual send. Validated so a typo can't silently
  // send to zero recipients under a "sent!" toast.
  const rawCityId = typeof body?.cityId === 'string' && body.cityId ? body.cityId : null
  let sendCityId: string | null = null
  if (rawCityId) {
    const c = await prisma.city.findUnique({ where: { id: rawCityId }, select: { id: true, name: true } })
    if (!c) return NextResponse.json({ error: 'Unknown city' }, { status: 400 })
    sendCityId = c.id
  }
  // The schedule is a wall-clock time ('YYYY-MM-DDTHH:MM', what the picker
  // sends) on the clock of the city being mailed — `scheduleTz`, the zone the
  // page showed the picker in. It used to go through new Date() on a UTC
  // server, so "18:00" meant 18:00 UTC: three hours late for Istanbul, and
  // every edit (prefilled on the admin's device clock) moved it again.
  // Without a tz, the admin's own city decides.
  let scheduledFor: Date | null = null
  if (body?.scheduledFor) {
    const raw = body.scheduledFor
    if (typeof raw !== 'string' || !(WALL_CLOCK.test(raw) || INSTANT.test(raw))) {
      return NextResponse.json({ error: 'Invalid scheduledFor date' }, { status: 400 })
    }
    if (body.scheduleTz !== undefined && !validTz(body.scheduleTz)) {
      return NextResponse.json({ error: 'Invalid schedule timezone' }, { status: 400 })
    }
    if (INSTANT.test(raw)) {
      scheduledFor = new Date(raw)
    } else {
      const tz = validTz(body.scheduleTz) ? body.scheduleTz : await getCityTz(await resolveCityId(session))
      scheduledFor = fromWallClockInTz(raw, tz)
    }
    if (isNaN(scheduledFor.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledFor date' }, { status: 400 })
    }
  }

  // Auto-digest preview — compose exactly what Monday's automated issue
  // would contain right now and deliver it to the requesting admin only.
  // Closes the "flip the toggle and hope" blindspot.
  if (body?.autoPreview === true) {
    const me = await prisma.user.findUnique({ where: { id: session.id }, select: { email: true, name: true } })
    if (!me?.email) return NextResponse.json({ error: 'No email on your account to send a preview to' }, { status: 400 })
    const digest = await buildWeeklyDigest()
    if (!digest) return NextResponse.json({ error: 'No events in the next 7 days — the auto-issue would be skipped' }, { status: 404 })
    try {
      await sendNewsletterEmail(session.id, me.email, me.name, `[PREVIEW] ${digest.subject}`, digest.bodyHtml, 'test', digest.preheader)
      return NextResponse.json({ ok: true, preview: true, email: me.email })
    } catch {
      return NextResponse.json({ error: 'Preview send failed' }, { status: 500 })
    }
  }

  if (!subject)  return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  if (!bodyHtml) return NextResponse.json({ error: 'Body is required' },    { status: 400 })
  if (bodyHtml.length > 100_000) return NextResponse.json({ error: 'Body too long (max 100 KB)' }, { status: 400 })

  const safeBodyHtml = sanitizeNewsletter(bodyHtml)

  // Test send — deliver a single copy to the current admin so they can preview
  // the real email (with the greeting + unsubscribe wrapper) before blasting a
  // segment. No Newsletter row, no audit, no fan-out.
  if (body?.test === true) {
    const me = await prisma.user.findUnique({ where: { id: session.id }, select: { email: true, name: true } })
    if (!me?.email) return NextResponse.json({ error: 'No email on your account to send a test to' }, { status: 400 })
    try {
      await sendNewsletterEmail(session.id, me.email, me.name, `[TEST] ${subject}`, safeBodyHtml, 'test')
      return NextResponse.json({ ok: true, test: true, email: me.email })
    } catch {
      return NextResponse.json({ error: 'Test send failed' }, { status: 500 })
    }
  }

  // Everything past here fans out to a segment (now, or via the sweeper). A
  // stolen password must not buy a mailing to the whole list; the preview and
  // test sends above go only to the admin's own inbox, so they stay open.
  const stepUp = requireStepUp(session)
  if (stepUp) return stepUp

  // A schedule time that has already passed is a mistake, not "send now":
  // it used to fall through to the immediate send below and mail the whole
  // segment on the spot.
  if (scheduledFor && scheduledFor <= new Date()) {
    return NextResponse.json({ error: 'That time has passed — pick a time in the future.' }, { status: 400 })
  }

  // The Newsletter row has no cityId column, so a scheduled send can't carry
  // the city scope — the sweeper would fire it to every city. Refuse the combo
  // until a Newsletter.cityId migration makes scheduling city-aware.
  if (sendCityId && scheduledFor) {
    return NextResponse.json({ error: "City-scoped newsletters can't be scheduled yet — send now, or schedule without a city scope." }, { status: 400 })
  }

  // Required on every fan-out, like the broadcast route: a send that outlives
  // nginx's timeout shows the admin an error while it keeps going, and the
  // retry they naturally press used to mail everyone twice. Claimed below,
  // only once every refusal has had its say, so a rejected attempt never
  // burns the key its corrected retry needs. Scoped to the sender.
  const requestId = body?.requestId
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) {
    return NextResponse.json({ error: 'requestId required — reload the page and try again' }, { status: 400 })
  }
  const claimKey = `newsletter:${session.id}:${requestId}`
  const DUPLICATE = { error: 'This newsletter was already sent or scheduled — check the history.', duplicate: true }

  // Editing a scheduled issue posts its replacement with replacesId, and the
  // original is retired in this same request. The page used to DELETE it in a
  // second call, and a failure there left both copies scheduled to go out. If
  // the original is no longer scheduled (the sweeper claimed it, or someone
  // cancelled it), nothing is written.
  const replacesId    = typeof body?.replacesId === 'string' && body.replacesId ? body.replacesId : null
  const REPLACED_GONE = { error: 'The original is no longer scheduled — it was sent or cancelled. Nothing was changed.' }
  const auditReplaced = async () => {
    if (!replacesId) return
    await writeAudit(
      session.id, session.name, 'newsletter.cancel', replacesId, 'newsletter',
      { subject, replacedByEdit: true },
      `Replaced a scheduled newsletter with an edited copy "${subject}"`,
    )
  }

  // For scheduled sends, persist and return early — the sweeper will fire it
  if (scheduledFor) {
    if (!(await claimOnce(claimKey, 60 * 60_000))) return NextResponse.json(DUPLICATE, { status: 409 })
    // A database error here scheduled nothing (the transaction rolls back, the
    // original with it): hand the key back and say so in JSON, or the page's
    // retry is told "duplicate" and clears a draft that never went anywhere.
    let newsletter: { id: string } | null
    try {
      newsletter = await prisma.$transaction(async tx => {
        if (replacesId) {
          const gone = await tx.newsletter.deleteMany({ where: { id: replacesId, status: 'scheduled' } })
          if (gone.count === 0) return null
        }
        return tx.newsletter.create({
          data: { subject, bodyHtml: safeBodyHtml, segment, recipientCount: 0, sentById: session.id, status: 'scheduled', scheduledFor },
        })
      })
    } catch (err) {
      console.error('[newsletter schedule]', err)
      await releaseClaim(claimKey)
      return NextResponse.json({ error: 'Couldn\'t save the schedule — nothing changed, try again.' }, { status: 500 })
    }
    if (!newsletter) {
      // Nothing was scheduled — hand the key back.
      await releaseClaim(claimKey)
      return NextResponse.json(REPLACED_GONE, { status: 409 })
    }
    await auditReplaced()
    return NextResponse.json({ ok: true, scheduled: true, newsletterId: newsletter.id, scheduledFor })
  }

  // Recipients are checked BEFORE the original is retired: a send-now edit to
  // an empty segment used to delete the scheduled original and then 400, and
  // every retry 409'd because there was no original left to replace.
  const recipients = await prisma.user.findMany({
    where:  recipientWhere(segment, sendCityId ?? undefined),
    select: { id: true, email: true, name: true },
  })
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No recipients match that segment/city' }, { status: 400 })
  }

  if (!(await claimOnce(claimKey, 60 * 60_000))) return NextResponse.json(DUPLICATE, { status: 409 })

  // Sending an edited copy now: retire the original first, so the sweeper
  // can't also send it. Every failure after this point says so
  // (originalRetired), so the page stops treating the draft as a replacement
  // and a retry sends it as a new newsletter instead of 409ing forever.
  // Retiring the original and recording the send happen together, before any
  // email: a database error there sent nothing and deleted nothing, so the
  // key goes back and the answer is JSON the page can act on.
  let newsletter: { id: string }
  try {
    const made = await prisma.$transaction(async tx => {
      if (replacesId) {
        const gone = await tx.newsletter.deleteMany({ where: { id: replacesId, status: 'scheduled' } })
        if (gone.count === 0) return null
      }
      // 'sending' until the batch returns: the row and the audit used to claim
      // "sent to N" before a single email left, so a dead API key produced a
      // success toast, a cleared composer and a sent-looking history row.
      return tx.newsletter.create({
        data: { subject, bodyHtml: safeBodyHtml, segment, recipientCount: recipients.length, sentById: session.id, status: 'sending' },
        select: { id: true },
      })
    })
    if (!made) {
      await releaseClaim(claimKey)
      return NextResponse.json(REPLACED_GONE, { status: 409 })
    }
    newsletter = made
  } catch (err) {
    console.error('[newsletter send]', err)
    await releaseClaim(claimKey)
    return NextResponse.json({ error: 'Couldn\'t start the send — nothing went out, try again.' }, { status: 500 })
  }
  if (replacesId) await auditReplaced()
  const originalRetired = !!replacesId

  // Batch API send (≤100 per request) — stays under Resend's rate limit,
  // unlike the old 50-concurrent-per-second loop that 429'd ~80% of a 1k blast.
  let batch: Awaited<ReturnType<typeof sendNewsletterBatch>>
  try {
    batch = await sendNewsletterBatch(recipients, subject, safeBodyHtml, newsletter.id)
  } catch (err) {
    // A throw here used to leave a non-JSON 500 and a row stuck in 'sending'.
    // Some emails may have left before it threw, so the message says to look
    // at the history before sending again.
    await prisma.newsletter.update({ where: { id: newsletter.id }, data: { status: 'failed', sentAt: new Date() } }).catch(() => {})
    recordEmailFailure({ helper: 'sendNewsletterBatch', recipient: 'newsletter', error: err, context: { newsletterId: newsletter.id } }).catch(() => {})
    return NextResponse.json({ error: 'The send failed partway or entirely — check the history before sending again.', newsletterId: newsletter.id, originalRetired }, { status: 502 })
  }
  const { sent, resendLogs, failed } = batch

  for (const f of failed) {
    recordEmailFailure({ helper: 'sendNewsletterEmail', recipient: f.email, error: f.error }).catch(() => {})
  }
  if (resendLogs.length > 0) {
    await prisma.newsletterEmailLog.createMany({ data: resendLogs, skipDuplicates: true })
  }

  const outcome = sent > 0 ? 'sent' : 'failed'
  await prisma.newsletter.update({ where: { id: newsletter.id }, data: { status: outcome, recipientCount: sent, sentAt: new Date() } })
  await writeAudit(
    session.id, session.name, 'newsletter.send', newsletter.id, 'newsletter',
    { recipientCount: sent, attempted: recipients.length, failed: failed.length, segment, cityId: sendCityId },
    sent > 0
      ? `Sent newsletter "${subject}" to ${sent} of ${recipients.length} members (segment: ${segment}${sendCityId ? `, city-scoped` : ''})`
      : `Newsletter "${subject}" FAILED — 0 of ${recipients.length} sent (segment: ${segment})`,
  )

  if (sent === 0) {
    // Nothing left the building, so a retry of this same draft is safe.
    await releaseClaim(claimKey)
    return NextResponse.json({ error: `Nothing was sent (${failed[0]?.error ?? 'delivery failed'}) — check the email provider and try again.`, sent, failed: failed.length, newsletterId: newsletter.id, originalRetired }, { status: 502 })
  }
  return NextResponse.json({ ok: true, sent, failed: failed.length, newsletterId: newsletter.id })
}

// DELETE /api/admin/newsletter — cancel a still-scheduled newsletter before
// the sweeper fires it. Only 'scheduled' rows can be cancelled (a sent one is
// already out the door). Deletes the row so it disappears from the list.
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const nl = await prisma.newsletter.findUnique({ where: { id }, select: { status: true, subject: true } })
  if (!nl) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (nl.status !== 'scheduled') {
    return NextResponse.json({ error: 'Only scheduled newsletters can be cancelled' }, { status: 400 })
  }

  await prisma.newsletter.delete({ where: { id } })
  await writeAudit(
    session.id, session.name, 'newsletter.cancel', id, 'newsletter',
    { subject: nl.subject },
    `Cancelled scheduled newsletter "${nl.subject}"`,
  )
  return NextResponse.json({ ok: true })
}

// PATCH /api/admin/newsletter — flip the weekly auto-newsletter toggle.
// Every Monday from 12:00 Istanbul the newsletter sweeper composes the
// digest (events + clubs + new reads + new members) and sends it to all
// opted-in members; see runAutoDigest in the sweep-newsletters cron.
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { autoWeekly } = await req.json().catch(() => ({}))
  if (typeof autoWeekly !== 'boolean') {
    return NextResponse.json({ error: 'autoWeekly must be a boolean' }, { status: 400 })
  }
  await prisma.appSetting.upsert({
    where:  { key: 'autoWeeklyNewsletter' },
    create: { key: 'autoWeeklyNewsletter', value: autoWeekly ? 'on' : 'off' },
    update: { value: autoWeekly ? 'on' : 'off' },
  })
  await writeAudit(
    session.id, session.name, 'newsletter.automation', 'autoWeeklyNewsletter', 'setting',
    { autoWeekly },
    `Weekly auto-newsletter turned ${autoWeekly ? 'ON' : 'OFF'}`,
  )
  return NextResponse.json({ ok: true, autoWeekly })
}
