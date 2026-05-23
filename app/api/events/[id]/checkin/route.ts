import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { sendPushToUser } from '@/lib/push'

type Params = { params: Promise<{ id: string }> }

async function canManageEvent(sessionId: string, eventId: string, sessionRole: string): Promise<boolean> {
  if (sessionRole === 'admin') return true
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { clubId: true, hostId: true } })
  if (!event) return false
  if (event.hostId === sessionId) return true
  const cohost = await prisma.eventCoHost.findUnique({ where: { eventId_userId: { eventId, userId: sessionId } } })
  if (cohost) return true
  const membership = await prisma.clubMembership.findFirst({
    where: { userId: sessionId, clubId: event.clubId, role: 'host', status: 'approved' },
  })
  return !!membership
}

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id: eventId } = await params
    if (!await canManageEvent(session.id, eventId, session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const attendees = await prisma.eventAttendee.findMany({
      where: { eventId, status: 'approved' },
      include: { user: { select: { id: true, name: true, color: true, email: true, profilePhoto: true } } },
      orderBy: { joinedAt: 'asc' },
    })

    // Privacy Masking: Only Admins and the Primary Host see emails. 
    // Co-hosts and Club Hosts only see Name/Photo for check-in.
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { hostId: true } })
    const canSeeEmail = isAdmin(session) || event?.hostId === session.id

    const mapped = attendees.map(a => {
      const { email, ...publicUser } = a.user
      return {
        ...a,
        user: canSeeEmail ? a.user : publicUser
      }
    })

    return NextResponse.json(mapped)
  } catch (e) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id: eventId } = await params
    if (!await canManageEvent(session.id, eventId, session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { userId, checkedIn } = await req.json()
    if (typeof checkedIn !== 'boolean') {
      return NextResponse.json({ error: 'checkedIn must be a boolean' }, { status: 400 })
    }

    const updated = await prisma.eventAttendee.update({
      where: { userId_eventId: { userId, eventId } },
      data: { checkedIn },
    })

    if (checkedIn) {
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { title: true, emoji: true } })
      if (event) {
        sendPushToUser(userId, {
          title: `${event.emoji} You're checked in!`,
          body: `Welcome to ${event.title}. Enjoy the event!`,
          link: `/app/events/${eventId}`,
        }).catch(() => {})
      }
    }

    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
