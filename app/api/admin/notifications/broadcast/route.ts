import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canSendBroadcasts, isAdmin, failClosedCityId } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { createNotification } from '@/lib/notify'
import { sendBroadcastEmail } from '@/lib/email'

export async function GET() {
  const session = await getSession()
  if (!session || !canSendBroadcasts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const history = await prisma.broadcast.findMany({
    // Moderators: their own city's sends plus the network-wide ones.
    where:   isAdmin(session) ? {} : { OR: [{ cityId: failClosedCityId(session) }, { cityId: null }] },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json(history)
}

// PATCH /api/admin/notifications/broadcast — edit a sent broadcast.
// Admin-only. Updates the Broadcast record AND every matching in-app
// notification row: fan-out rows don't carry a broadcast FK, so the
// linkage is the broadcast's exact type+title+body (identical for all
// rows created by one send). Read state is preserved. Already-delivered
// emails can't be recalled — the response reports how many in-app rows
// were rewritten.
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, title, message } = await req.json()
  if (!id || !title?.trim() || !message?.trim()) {
    return NextResponse.json({ error: 'id, title and message required' }, { status: 400 })
  }

  const b = await prisma.broadcast.findUnique({ where: { id } })
  if (!b) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const notifType = b.type === 'alert' ? 'system_alert' : 'announcement'
  const rewritten = await prisma.notification.updateMany({
    where: { type: notifType, title: b.title, body: b.message },
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

  const { title, message, type, channel, audience, clubId, eventId, cityId } = await req.json()
  if (!title?.trim() || !message?.trim()) return NextResponse.json({ error: 'Title and message required' }, { status: 400 })

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
      if (!cl || !canSendBroadcasts(session, cl.cityId)) {
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

  // Fetch users with email + unsubscribe preference
  let users: { id: string; name: string; email: string; emailMarketing: boolean }[] = []

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

  // Deduplicate by userId
  const seen  = new Set<string>()
  const dedup = users.filter(u => { if (seen.has(u.id)) return false; seen.add(u.id); return true })

  if (isEmail) {
    // Only email users who haven't unsubscribed
    const eligible = dedup.filter(u => u.emailMarketing)
    await Promise.allSettled(
      eligible.map(u => sendBroadcastEmail(u.id, u.email, u.name, title.trim(), message.trim()))
    )
    // Also send in-app notification
    await Promise.allSettled(
      dedup.map(u => createNotification(u.id, notifType, title.trim(), message.trim(), link))
    )
    await prisma.broadcast.create({
      data: { title: title.trim(), message: message.trim(), type: type ?? 'announcement',
              audience: audience ?? 'all', channel: 'email',
              clubId: clubId || null, eventId: eventId || null,
              cityId: audience === 'city' ? cityId : null,
              sentBy: session.name, sentCount: eligible.length },
    })
    return NextResponse.json({ ok: true, sent: eligible.length, skipped: dedup.length - eligible.length })
  } else {
    await Promise.allSettled(
      dedup.map(u => createNotification(u.id, notifType, title.trim(), message.trim(), link))
    )
    await prisma.broadcast.create({
      data: { title: title.trim(), message: message.trim(), type: type ?? 'announcement',
              audience: audience ?? 'all', channel: 'in-app',
              clubId: clubId || null, eventId: eventId || null,
              cityId: audience === 'city' ? cityId : null,
              sentBy: session.name, sentCount: dedup.length },
    })
    return NextResponse.json({ ok: true, sent: dedup.length })
  }
}
