import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canSendBroadcasts, isAdmin } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { sendBroadcastEmail } from '@/lib/email'

export async function GET() {
  const session = await getSession()
  if (!session || !canSendBroadcasts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const history = await prisma.broadcast.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json(history)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canSendBroadcasts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, message, type, channel, audience, clubId, eventId } = await req.json()
  if (!title?.trim() || !message?.trim()) return NextResponse.json({ error: 'Title and message required' }, { status: 400 })

  const notifType = type === 'alert' ? 'system_alert' : 'announcement'
  const link      = eventId ? `/events/${eventId}` : clubId ? `/clubs/${clubId}` : undefined
  const isEmail   = channel === 'email'

  // City-scope check for non-admins. Previously a moderator could broadcast
  // to *every* approved user across *every* city. Now we derive the target
  // city from the audience:
  //   - `audience === 'all'`     → admins only
  //   - `audience === 'event'`   → must match the event's cityId
  //   - `audience === 'club'`    → must match the club's cityId
  if (!isAdmin(session)) {
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
              audience: audience ?? 'all', clubId: clubId || null, eventId: eventId || null,
              sentBy: session.name, sentCount: eligible.length },
    })
    return NextResponse.json({ ok: true, sent: eligible.length, skipped: dedup.length - eligible.length })
  } else {
    await Promise.allSettled(
      dedup.map(u => createNotification(u.id, notifType, title.trim(), message.trim(), link))
    )
    await prisma.broadcast.create({
      data: { title: title.trim(), message: message.trim(), type: type ?? 'announcement',
              audience: audience ?? 'all', clubId: clubId || null, eventId: eventId || null,
              sentBy: session.name, sentCount: dedup.length },
    })
    return NextResponse.json({ ok: true, sent: dedup.length })
  }
}
