import { NextRequest, NextResponse, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canSendBroadcasts, isAdmin, failClosedCityId } from '@/lib/access'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { requireStepUp } from '@/lib/stepUp'
import { createNotification, recipientSkipReason } from '@/lib/notify'
import { sendBroadcastEmail, recordEmailFailure } from '@/lib/email'
import { claimOnce, releaseClaim, rateLimit, rateLimitRemaining } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'

// Sends go out in sequential chunks. One Resend call per member all at once
// trips Resend's rate limit on any real audience, and a burst of that size
// also drains the DB pool the in-app fan-out shares.
const SEND_CHUNK = 50

// How far back a moderator's history scan reaches before it filters club and
// event sends down to their city. Bounded so the lookup below stays two small
// queries; the page only ever shows 50.
const MOD_HISTORY_SCAN = 300

// How long AFTER its Broadcast row an edit looks for that send's in-app rows.
// The row is written first and the fan-out follows (50-row chunks, ~16 min
// for a whole-membership email), so the rows carry createdAt >= the row's.
// Sends from before 2026-09-22 were the other way round — fan-out first, row
// last — and the edit still reaches those by looking the hour BEFORE too.
const EDIT_WINDOW_MS = 60 * 60_000

// The client's per-compose idempotency key. Short and plain so it can't bloat
// or poison the rate_limits key it becomes.
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/

// An audience is one of four things, named explicitly. It used to be whatever
// the client said, with a bare `else` meaning "every approved member in every
// city" — so {audience:'club', clubId:null}, a typo'd 'Club', or an omitted
// key all reached the whole membership while the history recorded the smaller
// audience the sender thought they had picked.
const AUDIENCES = ['all', 'city', 'club', 'event'] as const
type Audience = (typeof AUDIENCES)[number]
const TYPES    = ['announcement', 'reminder', 'alert'] as const
const CHANNELS = ['in-app', 'email'] as const
const TITLE_MAX   = 150
const MESSAGE_MAX  = 5_000
// A moderator's daily cap, and an admin's. An admin had none at all: a stolen
// session could send the whole membership an unrecallable email in a loop.
const MOD_SENDS_PER_DAY   = 5
const ADMIN_SENDS_PER_DAY = 10
const DAY_MS = 24 * 60 * 60_000

/** A body value that must be an id if it is present at all. Without this a
 *  Prisma filter object ({"not":null}) in clubId turned an equality into a
 *  filter and selected every club's members. */
function idOrNull(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  return typeof v === 'string' ? v : undefined   // undefined = invalid
}

function lengthError(title: string, message: string): string | null {
  if (title.length > TITLE_MAX)     return `Keep the title under ${TITLE_MAX} characters`
  if (message.length > MESSAGE_MAX) return `Keep the message under ${MESSAGE_MAX.toLocaleString('en-US')} characters`
  return null
}

// Run work after the response has gone out. Next's after() keeps the request
// alive for it in production; it throws when there is no request scope —
// which is every unit test that calls POST() directly — and the work must
// still happen, so that case falls back to a plain floating promise.
function afterResponse(run: () => Promise<void>): void {
  try { after(run) } catch { void run() }
}

async function inChunks<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = []
  for (let i = 0; i < items.length; i += SEND_CHUNK) {
    out.push(...await Promise.allSettled(items.slice(i, i + SEND_CHUNK).map(fn)))
  }
  return out
}

export async function GET() {
  const session = await getSession()
  if (!session || !canSendBroadcasts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Null for an admin: they have a daily cap too now, but it is a guard
  // against a stolen session rather than an allowance to budget, so the
  // composer doesn't count it down at them.
  const sendsLeftToday = isAdmin(session)
    ? null
    : await rateLimitRemaining(`broadcast-mod:${session.id}`, MOD_SENDS_PER_DAY)

  if (isAdmin(session)) {
    const history = await prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
    return NextResponse.json({ history, sendsLeftToday })
  }

  // Moderators see only sends they could have made themselves: their city's
  // city-wide sends, plus club and event sends whose club or event is in
  // their city. Broadcast.cityId is set only for audience 'city', so a
  // cityId-null row is either network-wide (never theirs) or a club/event
  // send from ANY city — resolved through the club/event's own city below.
  const own = failClosedCityId(session)
  const candidates = await prisma.broadcast.findMany({
    where: { OR: [
      { cityId: own },
      { cityId: null, audience: 'club',  clubId:  { not: null } },
      { cityId: null, audience: 'event', eventId: { not: null } },
    ] },
    orderBy: { createdAt: 'desc' },
    take: MOD_HISTORY_SCAN,
  })
  const clubIds  = [...new Set(candidates.flatMap(b => !b.cityId && b.audience === 'club'  && b.clubId  ? [b.clubId]  : []))]
  const eventIds = [...new Set(candidates.flatMap(b => !b.cityId && b.audience === 'event' && b.eventId ? [b.eventId] : []))]
  const [clubs, events] = await Promise.all([
    clubIds.length  ? prisma.club.findMany({  where: { id: { in: clubIds } },  select: { id: true, cityId: true } }) : [],
    eventIds.length ? prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, cityId: true } }) : [],
  ])
  const clubCity  = new Map(clubs.map(c => [c.id, c.cityId]))
  const eventCity = new Map(events.map(e => [e.id, e.cityId]))
  // A deleted club/event resolves to undefined and drops out — fail closed.
  const history = candidates.filter(b =>
    b.cityId === own
    || (b.audience === 'club'  && !!b.clubId  && clubCity.get(b.clubId)   === own)
    || (b.audience === 'event' && !!b.eventId && eventCity.get(b.eventId) === own),
  ).slice(0, 50)
  return NextResponse.json({ history, sendsLeftToday })
}

// Club pages live at /clubs/<slug>. Broadcasts linked `/clubs/<clubId>` until
// 2026-09-14, so every club broadcast's notification opened a 404 — and the
// edit below still has to find those older rows by the id form (`legacy`).
async function broadcastLink(eventId: string | null | undefined, clubId: string | null | undefined): Promise<{ link?: string; legacy?: string }> {
  if (eventId) return { link: `/events/${eventId}` }
  if (!clubId) return {}
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { slug: true } })
  return { link: club ? `/clubs/${club.slug}` : undefined, legacy: `/clubs/${clubId}` }
}

// PATCH /api/admin/notifications/broadcast — edit a sent broadcast.
// Admin-only. Updates the Broadcast record AND every matching in-app
// notification row: fan-out rows don't carry a broadcast FK, so the
// linkage is the broadcast's exact type+title+body+link inside the window
// its own fan-out ran in (see EDIT_WINDOW_MS above). Read state is preserved.
// Already-delivered emails can't be recalled — the response reports how many
// in-app rows were rewritten.
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, title, message, imageUrl } = await req.json()
  if (!id || typeof id !== 'string' || !title?.trim() || !message?.trim()) {
    return NextResponse.json({ error: 'id, title and message required' }, { status: 400 })
  }
  const lenErr = lengthError(String(title).trim(), String(message).trim())
  if (lenErr) return NextResponse.json({ error: lenErr }, { status: 400 })
  // The emails are gone the moment they send, so the in-app rows are the only
  // surface an edit can still reach — which makes a wrong image exactly the
  // thing this flow exists to fix. Absent = leave it; null = take it off.
  let imagePatch: { imageUrl: string | null } | Record<string, never> = {}
  if (imageUrl !== undefined) {
    const clean = imageUrl ? String(imageUrl).trim() : ''
    if (clean && !isUploadedImageUrl(clean, ['broadcasts'])) {
      return NextResponse.json({ error: 'The image has to be uploaded with the broadcast — an external link is not allowed' }, { status: 400 })
    }
    imagePatch = { imageUrl: clean || null }
  }

  const b = await prisma.broadcast.findUnique({ where: { id } })
  if (!b) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // type+title+body alone is not one send: a weekly "Reminder" re-sent with
  // the same text, or the same copy sent to two clubs, had every earlier
  // send's rows rewritten too. Notifications carry no broadcast id and no
  // sender, so the match is narrowed to this send's own rows: the link POST
  // gave them, and createdAt inside its fan-out. The fan-out now runs AFTER
  // the row (from b.createdAt until it finished, or until the next identical
  // send began, or the window); rows from before 2026-09-22 were written
  // BEFORE their row, so that arm — the hour up to b.createdAt, bounded by
  // the previous identical send — is kept for them.
  const notifType = b.type === 'alert' ? 'system_alert' : 'announcement'
  const { link: current, legacy } = await broadcastLink(b.eventId, b.clubId)
  const link      = legacy ? { in: [current, legacy].filter((l): l is string => !!l) } : (current ?? null)
  const same = { id: { not: b.id }, title: b.title, message: b.message, clubId: b.clubId, eventId: b.eventId }
  const [previous, next] = await Promise.all([
    prisma.broadcast.findFirst({ where: { ...same, createdAt: { lte: b.createdAt } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.broadcast.findFirst({ where: { ...same, createdAt: { gt:  b.createdAt } }, orderBy: { createdAt: 'asc'  }, select: { createdAt: true } }),
  ])
  const floor   = new Date(b.createdAt.getTime() - EDIT_WINDOW_MS)
  const from    = previous && previous.createdAt > floor ? previous.createdAt : floor
  const ceiling = new Date(b.createdAt.getTime() + EDIT_WINDOW_MS)
  const until   = [b.finishedAt, next?.createdAt, ceiling].filter((d): d is Date => !!d).reduce((a, c) => (c < a ? c : a))
  const rewritten = await prisma.notification.updateMany({
    where: {
      type: notifType, title: b.title, body: b.message, link,
      OR: [
        { createdAt: { gte: b.createdAt, lt: until } },   // row first, fan-out after (2026-09-22 on)
        { createdAt: { gt: from, lte: b.createdAt } },     // fan-out first, row after (before)
      ],
    },
    data:  { title: title.trim(), body: message.trim(), ...imagePatch },
  })
  await prisma.broadcast.update({
    where: { id },
    data:  { title: title.trim(), message: message.trim(), ...imagePatch },
  })

  // The one operation that can retroactively change what the community was
  // told left no trace at all — not who did it, not what it said before, not
  // how many people's copies moved. On a record of what was announced, that
  // is the entry that matters most.
  writeAudit(session.id, session.name, 'broadcast.edit', id, 'broadcast',
    { before: { title: b.title, message: b.message, imageUrl: b.imageUrl },
      after:  { title: title.trim(), message: message.trim(), ...imagePatch },
      notificationsUpdated: rewritten.count, outsideWindow: rewritten.count === 0,
      originallySentBy: b.sentBy, originallySentAt: b.createdAt.toISOString() },
    `Edited broadcast "${b.title.slice(0, 60)}" (${rewritten.count} member notifications rewritten)`,
  )

  // `outsideWindow` is the difference between "members see the correction"
  // and "only this record changed" — the note in the composer promised the
  // former for a send of any age, and a 0-row result was reported as success.
  return NextResponse.json({
    ok: true,
    rewritten:     rewritten.count,
    outsideWindow: rewritten.count === 0,
    // Kept for older clients that read the previous field name.
    notificationsUpdated: rewritten.count,
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canSendBroadcasts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, message, type, channel, audience, clubId, eventId, cityId, requestId, imageUrl } = await req.json()
  if (!title?.trim() || !message?.trim()) return NextResponse.json({ error: 'Title and message required' }, { status: 400 })
  // Our own uploads only. This URL is rendered as <img src> in an email to
  // the whole audience and on a public-facing card; an external one would
  // hand a third party the IP of every member who opened it — the same rule
  // post covers and article bodies follow (lib/uploadedImageUrl).
  const cleanImage = imageUrl ? String(imageUrl).trim() : ''
  if (cleanImage && !isUploadedImageUrl(cleanImage, ['broadcasts'])) {
    return NextResponse.json({ error: 'The image has to be uploaded with the broadcast — an external link is not allowed' }, { status: 400 })
  }
  const image = cleanImage || null
  // Required, not optional: a send that outlives nginx's timeout shows the
  // admin an error page while it keeps going, and without a key the retry
  // they naturally press sends the whole thing twice.
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 })
  }

  const lenErr = lengthError(String(title).trim(), String(message).trim())
  if (lenErr) return NextResponse.json({ error: lenErr }, { status: 400 })

  // Named, not inferred. Every id is checked for being an id, and the one
  // the audience needs must be there — the whole membership used to be the
  // fall-through for anything that didn't match a smaller case.
  if (!AUDIENCES.includes(audience as Audience)) {
    return NextResponse.json({ error: 'Pick who this goes to' }, { status: 400 })
  }
  const aud = audience as Audience
  const cleanClubId  = idOrNull(clubId)
  const cleanEventId = idOrNull(eventId)
  const cleanCityId  = idOrNull(cityId)
  if (cleanClubId === undefined || cleanEventId === undefined || cleanCityId === undefined) {
    return NextResponse.json({ error: 'Bad club, event or city' }, { status: 400 })
  }
  if (aud === 'club'  && !cleanClubId)  return NextResponse.json({ error: 'Pick a club' },  { status: 400 })
  if (aud === 'event' && !cleanEventId) return NextResponse.json({ error: 'Pick an event' }, { status: 400 })
  if (aud === 'city'  && !cleanCityId)  return NextResponse.json({ error: 'Pick a city' },  { status: 400 })
  if (type !== undefined && !TYPES.includes(type)) {
    return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
  }
  if (channel !== undefined && !CHANNELS.includes(channel)) {
    return NextResponse.json({ error: 'Unknown channel' }, { status: 400 })
  }

  const notifType = type === 'alert' ? 'system_alert' : 'announcement'
  const isEmail   = channel === 'email'

  // `audience === 'city'` → every approved member of one city. Validated for
  // every role — a typo'd id must not fall through to a smaller-than-intended
  // (or empty) send that the toast would still report as success. The gate is
  // canSendBroadcasts itself: admins reach any city, a moderator exactly
  // their own — which also makes this the first audience besides club/event
  // a moderator can use.
  if (aud === 'city') {
    const city = await prisma.city.findUnique({ where: { id: cleanCityId! }, select: { id: true } })
    if (!city) return NextResponse.json({ error: 'Unknown city' }, { status: 400 })
    if (!canSendBroadcasts(session, city.id)) {
      return NextResponse.json({ error: 'Cross-city broadcast is admin-only' }, { status: 403 })
    }
  }

  // City-scope check for non-admins. Previously a moderator could broadcast
  // to *every* approved user across *every* city. Now we derive the target
  // city from the audience:
  //   - `audience === 'all'`     → admins only
  //   - `audience === 'city'`    → gated above via canSendBroadcasts
  //   - `audience === 'event'`   → must match the event's cityId
  //   - `audience === 'club'`    → must match the club's cityId
  if (!isAdmin(session) && aud !== 'city') {
    if (aud === 'event') {
      const ev = await prisma.event.findUnique({ where: { id: cleanEventId! }, select: { cityId: true } })
      if (!ev || !canSendBroadcasts(session, ev.cityId)) {
        return NextResponse.json({ error: 'Cross-city broadcast is admin-only' }, { status: 403 })
      }
    } else if (aud === 'club') {
      const cl = await prisma.club.findUnique({ where: { id: cleanClubId! }, select: { cityId: true } })
      // A global club (cityId null) has members in every city, and
      // canActInCity treats "no city" as admin/mod parity — so the null
      // check has to be explicit or any moderator emails the whole network.
      if (!cl || !cl.cityId || !canSendBroadcasts(session, cl.cityId)) {
        return NextResponse.json({ error: 'Cross-city broadcast is admin-only' }, { status: 403 })
      }
    } else {
      // Global broadcast — admin-only.
      return NextResponse.json({ error: 'Global broadcast is admin-only' }, { status: 403 })
    }
  }

  // "Every approved member in every city" — the one audience with no correct
  // smaller target and no undo. It is now what the sender asked for by name,
  // never what a missing id left over. Moderators never reach it (403 above),
  // so this only ever asks an admin.
  const isGlobal = aud === 'all'
  if (isGlobal) {
    const stepUp = requireStepUp(session)
    if (stepUp) return stepUp
  }

  // Claimed only once every refusal above has had its say, so a rejected
  // attempt never burns the key the corrected retry needs. Scoped to the
  // sender so one admin's id can't block another's.
  const claimKey = `broadcast:${session.id}:${requestId}`
  // A day, not an hour: a whole-membership email runs ~16 minutes, and the
  // same requestId pressed again after the hour used to send it all twice.
  if (!(await claimOnce(claimKey, DAY_MS))) {
    return NextResponse.json({ error: 'This broadcast was already sent' }, { status: 409 })
  }
  // Counted AFTER the audience is known, so a database blip resolving the
  // recipient list can't quietly spend one of the day's sends. An admin has a
  // cap too now: they had none, so a stolen session could send the whole
  // membership an unrecallable email in a loop.
  const capKey   = isAdmin(session) ? `broadcast-admin:${session.id}` : `broadcast-mod:${session.id}`
  const capLimit = isAdmin(session) ? ADMIN_SENDS_PER_DAY : MOD_SENDS_PER_DAY

  // Who it goes to. Suspension lives in suspendedUntil with status still
  // 'approved', so it has to be read here: the in-app fan-out already skips
  // an announcement to a suspended member (lib/notify SUSPENDED_SKIPPED_TYPES)
  // and the email did not — the louder, un-recallable channel ignored the
  // suspension the quieter one honours.
  // cityId is here for quiet hours: createNotification resolves the quiet
  // window in the member's own city's timezone, and a recipient row without
  // it reads as "no city" — Istanbul time for a member in Tbilisi.
  type Recipient = { id: string; name: string; email: string; emailMarketing: boolean; emailVerified: boolean; status: string; suspendedUntil: Date | null; cityId: string | null }
  const PICK = { id: true, name: true, email: true, emailMarketing: true, emailVerified: true, status: true, suspendedUntil: true, cityId: true } as const
  let users: Recipient[] = []

  try {
    if (aud === 'event') {
      const attendees = await prisma.eventAttendee.findMany({
        // Live accounts only: a ban keeps club memberships and seats on
        // purpose, and a self-deleted account is a banned one with a dead
        // @deleted.smileys address — both were emailed.
        where:   { eventId: cleanEventId!, status: 'approved', user: { status: 'approved' } },
        include: { user: { select: PICK } },
      })
      users = attendees.map(a => a.user)
    } else if (aud === 'club') {
      const members = await prisma.clubMembership.findMany({
        where:   { clubId: cleanClubId!, status: 'approved', user: { status: 'approved' } },
        include: { user: { select: PICK } },
      })
      users = members.map(m => m.user)
    } else if (aud === 'city') {
      users = await prisma.user.findMany({ where: { status: 'approved', cityId: cleanCityId! }, select: PICK })
    } else {
      users = await prisma.user.findMany({ where: { status: 'approved' }, select: PICK })
    }
  } catch (e) {
    // Nothing has gone out yet — hand the key back so the retry isn't told
    // "already sent" about a send that never happened.
    await releaseClaim(claimKey)
    throw e
  }

  // Deduplicate by userId
  const seen  = new Set<string>()
  const dedup = users.filter(u => { if (seen.has(u.id)) return false; seen.add(u.id); return true })

  // Decided before the day's send is spent: an empty club cost a moderator
  // one of five and then told them nothing went.
  if (dedup.length === 0) {
    await releaseClaim(claimKey)
    return NextResponse.json({ error: 'That audience has nobody in it — nothing was sent' }, { status: 400 })
  }

  if (!await rateLimit(capKey, capLimit, DAY_MS)) {
    await releaseClaim(claimKey)
    return NextResponse.json({
      error: isAdmin(session)
        ? `That is ${capLimit} broadcasts in 24 hours — the cap is there so a stolen session can't mail the membership.`
        : 'Daily broadcast limit reached — ask an admin',
    }, { status: 429 })
  }

  // Who will actually be written a bell entry. createNotification resolves
  // `true` for a member it deliberately skipped, so counting its answers
  // reported suspended members as notified — and that inflated number was
  // stored on the row and printed in the history forever.
  const willNotify = dedup.filter(u => !recipientSkipReason(u, notifType))
  // Email: unsubscribed members are out, and so are unverified addresses —
  // a fan-out of hard bounces is attributed to the sending domain and then
  // degrades the password resets and activation links that share it.
  const eligible = isEmail
    ? dedup.filter(u => u.emailMarketing && u.emailVerified && !recipientSkipReason(u, notifType))
    : []

  // Resolved here, after every refusal, so the club lookup never runs for a
  // send that is turned away. A vanished club gets no link rather than a 404.
  // Kept as this exact destructuring: tests/scan5Batch37's link scanner
  // proves every notification link is a literal template by following
  // `const { link } = broadcastLink(...)`, and cannot follow a hoisted `let`.
  const { link } = await broadcastLink(cleanEventId, cleanClubId)

  // Nothing has gone out yet — a failure writing the row hands the key back,
  // or the retry is told "already sent" about a send that never happened
  // and the composer is wiped.
  let record: { id: string }
  try {
    // The row goes in BEFORE the fan-out. A whole-membership email is ~1,700
    // messages paced at 550ms — about sixteen minutes — and nginx closes the
    // connection at sixty seconds, so the sender always saw "no clear answer,
    // check Broadcast History before retrying" against a history that stayed
    // empty until the very end. The advice led straight to a second send.
    // finishedAt null is "still going".
    record = await prisma.broadcast.create({
      data: { title: title.trim(), message: message.trim(), type: type ?? 'announcement',
              imageUrl: image,
              audience: aud, channel: isEmail ? 'email' : 'in-app',
              clubId: cleanClubId, eventId: cleanEventId,
              cityId: aud === 'city' ? cleanCityId : null,
              sentBy: session.name, sentById: session.id,
              // Filled in when the fan-out finishes.
              sentCount: 0, finishedAt: null },
      select: { id: true },
    })
  } catch (e) {
    await releaseClaim(claimKey)
    throw e
  }

  writeAudit(session.id, session.name, 'broadcast.send', record.id, 'broadcast',
    { audience: aud, channel: isEmail ? 'email' : 'in-app', clubId: cleanClubId, eventId: cleanEventId,
      cityId: aud === 'city' ? cleanCityId : null, imageUrl: image,
      recipients: dedup.length, willNotify: willNotify.length, emailEligible: eligible.length, requestId },
    `Sent "${title.trim().slice(0, 80)}" to ${dedup.length} (${aud}, ${isEmail ? 'email' : 'in-app'})`,
  )

  // Fanned out after the response. PM2 keeps this process alive, so the work
  // continues; a restart mid-send stops it, which is why the row records
  // what finished rather than what was intended.
  const fanOut = async () => {
    let emailed = 0
    if (isEmail) {
      const results = await inChunks(eligible, u => sendBroadcastEmail(u.id, u.email, u.name, title.trim(), message.trim(), image))
      const failures: Promise<void>[] = []
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') { emailed++; return }
        failures.push(recordEmailFailure({
          helper: 'sendBroadcastEmail', recipient: eligible[i].email, error: r.reason,
          context: { userId: eligible[i].id, audience: aud, requestId },
        }))
      })
      await Promise.all(failures)
    }

    // Read once for the whole audience: createNotification would otherwise
    // look each member's preferences up individually, which for a city-wide
    // announcement is one query per member against a ten-connection pool.
    const prefRows = await prisma.notificationPreference.findMany({ where: { userId: { in: willNotify.map(u => u.id) } } })
    const prefsBy  = new Map(prefRows.map(p => [p.userId, p]))
    // The recipient row is handed over too — it was just read, and passing it
    // saves createNotification a lookup per member.
    const notifyResults = await inChunks(willNotify, u =>
      createNotification(u.id, notifType, title.trim(), message.trim(), link,
        { status: u.status, suspendedUntil: u.suspendedUntil, cityId: u.cityId },
        prefsBy.get(u.id) ?? null, { imageUrl: image }))
    const notified = notifyResults.filter(r => r.status === 'fulfilled' && r.value === true).length

    await prisma.broadcast.update({
      where: { id: record.id },
      data:  { emailedCount: emailed, notifiedCount: notified,
               // Kept in step for anything still reading the single number.
               sentCount: isEmail ? emailed : notified,
               finishedAt: new Date() },
    })
  }
  afterResponse(() => fanOut().catch(async err => {
    console.error('[broadcast] fan-out failed', { broadcastId: record.id, err: String(err) })
    // Stamped anyway: a row stuck on "sending…" for ever is a worse answer
    // than one that says what got out before it broke.
    await prisma.broadcast.update({ where: { id: record.id }, data: { finishedAt: new Date() } }).catch(() => {})
  }))

  return NextResponse.json({
    ok:            true,
    broadcastId:   record.id,
    queued:        dedup.length,
    emailEligible: eligible.length,
  }, { status: 202 })
}
