import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { sendNewsletterEmail, sendNewsletterBatch, recordEmailFailure } from '@/lib/email'
import { buildWeeklyDigest } from '@/lib/newsletterDigest'
import { writeAudit } from '@/lib/audit'
import { sanitizeNewsletter } from '@/lib/sanitize'

export const dynamic = 'force-dynamic'

type Segment = 'all' | 'new' | 'active' | 'inactive'

const BASE_WHERE = { emailMarketing: true, emailVerified: true, status: 'approved' } as const

function recipientWhere(segment: Segment) {
  const now = new Date()
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000)
  switch (segment) {
    case 'new':
      return { ...BASE_WHERE, joinedAt: { gte: days(60) } }
    case 'active':
      return { ...BASE_WHERE, joinedEvents: { some: { status: 'approved', joinedAt: { gte: days(90) } } } }
    case 'inactive':
      return { ...BASE_WHERE, joinedEvents: { none: { status: 'approved', joinedAt: { gte: days(180) } } } }
    default:
      return BASE_WHERE
  }
}

// GET /api/admin/newsletter — history + segment counts + sample recipients
export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const autoSetting = await prisma.appSetting.findUnique({ where: { key: 'autoWeeklyNewsletter' } })

  const [newsletters, allCount, newCount, activeCount, inactiveCount, sampleRecipients] = await Promise.all([
    prisma.newsletter.findMany({
      orderBy: { sentAt: 'desc' },
      take: 50,
      include: { sentBy: { select: { name: true } } },
    }),
    prisma.user.count({ where: recipientWhere('all') }),
    prisma.user.count({ where: recipientWhere('new') }),
    prisma.user.count({ where: recipientWhere('active') }),
    prisma.user.count({ where: recipientWhere('inactive') }),
    prisma.user.findMany({
      where: BASE_WHERE,
      select: { name: true },
      take: 5,
      orderBy: { joinedAt: 'desc' },
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
    segmentCounts: { all: allCount, new: newCount, active: activeCount, inactive: inactiveCount },
    sampleRecipients: sampleRecipients.map(u => u.name.split(' ')[0]),
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
  const scheduledFor = body?.scheduledFor ? new Date(body.scheduledFor) : null
  if (scheduledFor && isNaN(scheduledFor.getTime())) {
    return NextResponse.json({ error: 'Invalid scheduledFor date' }, { status: 400 })
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
      await sendNewsletterEmail(session.id, me.email, me.name, `[PREVIEW] ${digest.subject}`, digest.bodyHtml, 'test')
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

  // For scheduled sends, persist and return early — the sweeper will fire it
  if (scheduledFor && scheduledFor > new Date()) {
    const newsletter = await prisma.newsletter.create({
      data: { subject, bodyHtml: safeBodyHtml, segment, recipientCount: 0, sentById: session.id, status: 'scheduled', scheduledFor },
    })
    return NextResponse.json({ ok: true, scheduled: true, newsletterId: newsletter.id, scheduledFor })
  }

  const recipients = await prisma.user.findMany({
    where:  recipientWhere(segment),
    select: { id: true, email: true, name: true },
  })

  const newsletter = await prisma.newsletter.create({
    data: { subject, bodyHtml: safeBodyHtml, segment, recipientCount: recipients.length, sentById: session.id },
  })

  await writeAudit(
    session.id, session.name, 'newsletter.send', newsletter.id, 'newsletter',
    { recipientCount: recipients.length, segment },
    `Sent newsletter "${subject}" to ${recipients.length} members (segment: ${segment})`,
  )

  // Batch API send (≤100 per request) — stays under Resend's rate limit,
  // unlike the old 50-concurrent-per-second loop that 429'd ~80% of a 1k blast.
  const { sent, resendLogs, failed } = await sendNewsletterBatch(recipients, subject, safeBodyHtml, newsletter.id)

  for (const f of failed) {
    recordEmailFailure({ helper: 'sendNewsletterEmail', recipient: f.email, error: f.error }).catch(() => {})
  }
  if (resendLogs.length > 0) {
    await prisma.newsletterEmailLog.createMany({ data: resendLogs, skipDuplicates: true })
  }

  // Correct recipientCount to what actually sent (it was created optimistically
  // as recipients.length). With the batch sender failures are ~0, but if some
  // do fail the stored stat stays truthful instead of over-reporting.
  if (sent !== recipients.length) {
    await prisma.newsletter.update({ where: { id: newsletter.id }, data: { recipientCount: sent } })
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
// Every Friday from 10:00 Istanbul the newsletter sweeper composes the
// digest (events + clubs + new members) and sends it to all opted-in
// members; see runAutoDigest in the sweep-newsletters cron.
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
