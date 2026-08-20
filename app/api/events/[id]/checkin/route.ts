import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canManageEventOps } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string }> }

// Shared predicate — see lib/access.canManageEventOps (adds co-hosts, one home).

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
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
    console.error('[checkin GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (!await rateLimit(`checkin-patch:${session.id}`, 120, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { userId, checkedIn } = await req.json()
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId must be a non-empty string' }, { status: 400 })
    }
    if (typeof checkedIn !== 'boolean') {
      return NextResponse.json({ error: 'checkedIn must be a boolean' }, { status: 400 })
    }

    const updated = await prisma.eventAttendee.update({
      where: { userId_eventId: { userId, eventId } },
      data: { checkedIn },
    })

    if (checkedIn) {
      const [event, checkedInUser, checkedInCount, totalCount] = await Promise.all([
        prisma.event.findUnique({
          where:  { id: eventId },
          select: { title: true, emoji: true, hostId: true },
        }),
        prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
        prisma.eventAttendee.count({ where: { eventId, checkedIn: true } }),
        prisma.eventAttendee.count({ where: { eventId, status: 'approved' } }),
      ])

      if (event) {
        // Attendee: welcome notification
        createNotification(
          userId,
          'checkin',
          `${event.emoji} You're checked in!`,
          `Welcome to ${event.title}. Enjoy the event!`,
          `/events/${eventId}`,
        ).catch(() => {})

        // Host: live count update (skip if the host is checking themselves in)
        if (event.hostId && event.hostId !== userId) {
          createNotification(
            event.hostId,
            'checkin_count',
            `${event.emoji} ${checkedInUser?.name ?? 'Someone'} just checked in`,
            `${checkedInCount}/${totalCount} checked in to ${event.title}`,
            `/host/checkin?event=${eventId}`,
          ).catch(() => {})
        }

        // On first check-in: notify admins + all other approved attendees
        // that doors are open. Only fires once per event so it's not spammy.
        if (checkedInCount === 1) {
          const [admins, otherAttendees] = await Promise.all([
            prisma.user.findMany({
              where:  { role: 'admin', status: 'approved' },
              select: { id: true },
            }),
            prisma.eventAttendee.findMany({
              where:  { eventId, status: 'approved', userId: { not: userId } },
              select: { userId: true },
            }),
          ])

          for (const admin of admins) {
            createNotification(
              admin.id,
              'checkin_started',
              `${event.emoji} Check-in started`,
              `${event.title} — first attendee just checked in`,
              `/admin/checkin?event=${eventId}`,
            ).catch(() => {})
          }

          for (const attendee of otherAttendees) {
            createNotification(
              attendee.userId,
              'checkin_started',
              `${event.emoji} Doors are open!`,
              `People are arriving at ${event.title} — see you there!`,
              `/events/${eventId}`,
            ).catch(() => {})
          }
        }
      }
    }

    return NextResponse.json(updated)
  } catch (e) {
    console.error('[checkin PATCH]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
