import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canSendBroadcasts, isAdmin, failClosedCityId } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { createNotification } from '@/lib/notify'
import { sendBroadcastEmail, recordEmailFailure } from '@/lib/email'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'

// Sends go out in sequential chunks. One Resend call per member all at once
// trips Resend's rate limit on any real audience, and a burst of that size
// also drains the DB pool the in-app fan-out shares.
const SEND_CHUNK = 50

// How far back a moderator's history scan reaches before it filters club and
// event sends down to their city. Bounded so the lookup below stays two small
// queries; the page only ever shows 50.
const MOD_HISTORY_SCAN = 300

// How long before its Broadcast row an edit looks for that send's in-app
// rows. The fan-out runs in 50-row chunks and ends before the row is written;
// an hour is far past any real audience, and the same span as the send claim.
const EDIT_WINDOW_MS = 60 * 60_000

// The client's per-compose idempotency key. Short and plain so it can't bloat
// or poison the rate_limits key it becomes.
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/

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
  if (isAdmin(session)) {
    const history = await prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
    return NextResponse.json(history)
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
  return NextResponse.json(history)
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

  const { id, title, message } = await req.json()
  if (!id || !title?.trim() || !message?.trim()) {
    return NextResponse.json({ error: 'id, title and message required' }, { status: 400 })
  }

  const b = await prisma.broadcast.findUnique({ where: { id } })
  if (!b) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // type+title+body alone is not one send: a weekly "Reminder" re-sent with
  // the same text, or the same copy sent to two clubs, had every earlier
  // send's rows rewritten too. Notifications carry no broadcast id and no
  // sender, so the match is narrowed to this send's own rows: the link POST
  // gave them, and createdAt inside its fan-out — which finishes before the
  // Broadcast row is written (so `lte b.createdAt`), and starts after the
  // previous identical send's row was (or at most EDIT_WINDOW_MS earlier).
  const notifType = b.type === 'alert' ? 'system_alert' : 'announcement'
  const link      = b.eventId ? `/events/${b.eventId}` : b.clubId ? `/clubs/${b.clubId}` : null
  const previous  = await prisma.broadcast.findFirst({
    where:   { id: { not: b.id }, title: b.title, message: b.message, clubId: b.clubId, eventId: b.eventId, createdAt: { lte: b.createdAt } },
    orderBy: { createdAt: 'desc' },
    select:  { createdAt: true },
  })
  const floor = new Date(b.createdAt.getTime() - EDIT_WINDOW_MS)
  const from  = previous && previous.createdAt > floor ? previous.createdAt : floor
  const rewritten = await prisma.notification.updateMany({
    where: { type: notifType, title: b.title, body: b.message, link, createdAt: { gt: from, lte: b.createdAt } },
    data:  { title: title.trim(), body: message.trim() },
  })
  await prisma.broadcast.update({
    where: { id },
    data:  { title: title.trim(), message: message.trim() },
  })

  return NextResponse.json({ ok: true, notificationsUpdated: rewritten.count })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canSendBroadcasts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, message, type, channel, audience, clubId, eventId, cityId, requestId } = await req.json()
  if (!title?.trim() || !message?.trim()) return NextResponse.json({ error: 'Title and message required' }, { status: 400 })
  // Required, not optional: a send that outlives nginx's timeout shows the
  // admin an error page while it keeps going, and without a key the retry
  // they naturally press sends the whole thing twice.
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 })
  }

  const notifType = type === 'alert' ? 'system_alert' : 'announcement'
  const link      = eventId ? `/events/${eventId}` : clubId ? `/clubs/${clubId}` : undefined
  const isEmail   = channel === 'email'

  // `audience === 'city'` → every approved member of one city. Validated for
  // every role — a typo'd id must not fall through to a smaller-than-intended
  // (or empty) send that the toast would still report as success. The gate is
  // canSendBroadcasts itself: admins reach any city, a moderator exactly
  // their own — which also makes this the first audience besides club/event
  // a moderator can use.
  if (audience === 'city') {
    if (!cityId) return NextResponse.json({ error: 'cityId required for a city broadcast' }, { status: 400 })
    const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true } })
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
  if (!isAdmin(session) && audience !== 'city') {
    if (audience === 'event' && eventId) {
      const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { cityId: true } })
      if (!ev || !canSendBroadcasts(session, ev.cityId)) {
        return NextResponse.json({ error: 'Cross-city broadcast is admin-only' }, { status: 403 })
      }
    } else if (audience === 'club' && clubId) {
      const cl = await prisma.club.findUnique({ where: { id: clubId }, select: { cityId: true } })
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

  // The fall-through below is "every approved member in every city" — the
  // one audience with no correct smaller target and no undo. Moderators never
  // reach it (403 above), so this only ever asks an admin. Club, event and
  // city sends are routine and stay on canSendBroadcasts alone.
  const isGlobal = !((audience === 'event' && eventId) || (audience === 'club' && clubId) || (audience === 'city' && cityId))
  if (isGlobal) {
    const stepUp = requireStepUp(session)
    if (stepUp) return stepUp
  }

  // Claimed only once every refusal above has had its say, so a rejected
  // attempt never burns the key the corrected retry needs. Scoped to the
  // sender so one admin's id can't block another's.
  const claimKey = `broadcast:${session.id}:${requestId}`
  if (!(await claimOnce(claimKey, 60 * 60_000))) {
    return NextResponse.json({ error: 'This broadcast was already sent' }, { status: 409 })
  }

  // Fetch users with email + unsubscribe preference
  let users: { id: string; name: string; email: string; emailMarketing: boolean }[] = []

  try {
    if (audience === 'event' && eventId) {
      const attendees = await prisma.eventAttendee.findMany({
        where: { eventId, status: 'approved' },
        include: { user: { select: { id: true, name: true, email: true, emailMarketing: true } } },
      })
      users = attendees.map(a => a.user)
    } else if (audience === 'club' && clubId) {
      const members = await prisma.clubMembership.findMany({
        where: { clubId, status: 'approved' },
        include: { user: { select: { id: true, name: true, email: true, emailMarketing: true } } },
      })
      users = members.map(m => m.user)
    } else if (audience === 'city' && cityId) {
      users = await prisma.user.findMany({
        where: { status: 'approved', cityId },
        select: { id: true, name: true, email: true, emailMarketing: true },
      })
    } else {
      users = await prisma.user.findMany({
        where: { status: 'approved' },
        select: { id: true, name: true, email: true, emailMarketing: true },
      })
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

  // Only email users who haven't unsubscribed
  const eligible = isEmail ? dedup.filter(u => u.emailMarketing) : []
  let emailed = 0
  if (isEmail) {
    const results = await inChunks(eligible, u => sendBroadcastEmail(u.id, u.email, u.name, title.trim(), message.trim()))
    // Every rejection lands in EmailFailure — allSettled alone swallowed them,
    // and the toast then reported the whole list as sent.
    const failures: Promise<void>[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { emailed++; return }
      failures.push(recordEmailFailure({
        helper: 'sendBroadcastEmail', recipient: eligible[i].email, error: r.reason,
        context: { userId: eligible[i].id, audience: audience ?? 'all', requestId },
      }))
    })
    await Promise.all(failures)
  }

  // In-app notification for the whole audience (email channel included).
  // createNotification resolves false on a failed write rather than throwing,
  // so a success is a fulfilled `true`, not merely a settled promise.
  const notifyResults = await inChunks(dedup, u => createNotification(u.id, notifType, title.trim(), message.trim(), link))
  const notified = notifyResults.filter(r => r.status === 'fulfilled' && r.value === true).length

  await prisma.broadcast.create({
    data: { title: title.trim(), message: message.trim(), type: type ?? 'announcement',
            audience: audience ?? 'all', channel: isEmail ? 'email' : 'in-app',
            clubId: clubId || null, eventId: eventId || null,
            cityId: audience === 'city' ? cityId : null,
            // What actually went out, not the size of the list we tried.
            sentBy: session.name, sentCount: isEmail ? emailed : notified },
  })

  return NextResponse.json({
    ok:           true,
    recipients:   dedup.length,
    notified,
    notifyFailed: dedup.length - notified,
    emailed,
    emailFailed:  eligible.length - emailed,
    skipped:      isEmail ? dedup.length - eligible.length : 0,
  })
}
