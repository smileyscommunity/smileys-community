import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost } from '@/lib/access'

const userSelect  = { id: true, name: true, color: true, email: true, profilePhoto: true }
// status is needed by /admin/participants so each event's section
// header can show a status pill (live / draft / cancelled / etc.) —
// without it, the admin moderating bulk requests can't tell that
// they're approving people into a cancelled event.
const eventSelect = { id: true, title: true, date: true, emoji: true, status: true }

export async function GET() {
  try {
    const session = await getSession()
    if (!session || (!isAdmin(session) && !await isClubHost(session.id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Hosts only see attendees for events in clubs they manage
    let eventIdFilter: { in: string[] } | undefined

    if (!isAdmin(session)) {
      const memberships = await prisma.clubMembership.findMany({
        where: { userId: session.id, role: 'host', status: 'approved' },
        select: { clubId: true },
      })
      const clubIds = memberships.map(m => m.clubId)
      const hostEvents = await prisma.event.findMany({
        where: { clubId: { in: clubIds } },
        select: { id: true },
      })
      eventIdFilter = { in: hostEvents.map(e => e.id) }
    }

    const [attendees, waitlistRaw] = await Promise.all([
      prisma.eventAttendee.findMany({
        where: eventIdFilter ? { eventId: eventIdFilter } : undefined,
        include: {
          user:  { select: userSelect },
          event: { select: eventSelect },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.waitlistEntry.findMany({
        where: eventIdFilter ? { eventId: eventIdFilter } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const waitlistUserIds  = waitlistRaw.map(w => w.userId)
    const waitlistEventIds = waitlistRaw.map(w => w.eventId)

    const [waitlistUsers, waitlistEvents] = waitlistUserIds.length ? await Promise.all([
      prisma.user.findMany({ where: { id: { in: waitlistUserIds } }, select: userSelect }),
      prisma.event.findMany({ where: { id: { in: waitlistEventIds } }, select: eventSelect }),
    ]) : [[], []]

    const userMap  = Object.fromEntries(waitlistUsers.map(u => [u.id, u]))
    const eventMap = Object.fromEntries(waitlistEvents.map(e => [e.id, e]))
    const waitlist = waitlistRaw.map(w => ({ ...w, user: userMap[w.userId], event: eventMap[w.eventId] }))

    return NextResponse.json({ attendees, waitlist })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
