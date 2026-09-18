import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { activeAttendeeWhere } from '@/lib/attendance'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost } from '@/lib/access'
import { citiesByToday } from '@/lib/city'

// phone + nationality power the per-row WhatsApp deep link (admin-only
// endpoint, same fields the per-event participants API exposes).
const userSelect  = { id: true, name: true, color: true, email: true, profilePhoto: true, phone: true, nationality: true }
// status is needed by /admin/participants so each event's section
// header can show a status pill (live / draft / cancelled / etc.) —
// without it, the admin moderating bulk requests can't tell that
// they're approving people into a cancelled event. spotsLeft/totalSpots
// drive the capacity badge + full-event promote guard. limitedSpots decides
// whether there is a cap at all (an unlimited event is never "Full"), and
// cityId lets the page judge "past" on the event's own city calendar.
const eventSelect = { id: true, title: true, date: true, emoji: true, status: true, spotsLeft: true, totalSpots: true, limitedSpots: true, cityId: true }

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
        // Active clubs only: the gate above passes on any one active club, and
        // an inactive club's attendees (email, phone) are not its host's to see.
        where: { userId: session.id, role: 'host', status: 'approved', club: { isActive: true } },
        select: { clubId: true },
      })
      const clubIds = memberships.map(m => m.clubId)
      const hostEvents = await prisma.event.findMany({
        where: { clubId: { in: clubIds } },
        select: { id: true },
      })
      eventIdFilter = { in: hostEvents.map(e => e.id) }
    }

    // "Upcoming" is judged on each event's own city calendar. One today for
    // the whole list — the admin's view city — dropped a city's events while
    // its day was still running (or kept yesterday's) whenever the two
    // cities' dates differ. Cities sharing a date share one clause.
    const upcoming = { OR: (await citiesByToday()).map(d => ({ cityId: { in: d.cityIds }, date: { gte: d.date } })) }

    const [attendees, waitlistRaw] = await Promise.all([
      prisma.eventAttendee.findMany({
        where: {
          ...(eventIdFilter ? { eventId: eventIdFilter } : {}),
          ...activeAttendeeWhere,
          event: upcoming,
        },
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
      prisma.event.findMany({ where: { id: { in: waitlistEventIds }, ...upcoming }, select: eventSelect }),
    ]) : [[], []]

    const userMap  = Object.fromEntries(waitlistUsers.map(u => [u.id, u]))
    const eventMap = Object.fromEntries(waitlistEvents.map(e => [e.id, e]))
    const waitlist = waitlistRaw
      .map(w => ({ ...w, user: userMap[w.userId], event: eventMap[w.eventId] }))
      // waitlist has no FK to users, so a deleted member leaves an orphan row
      // whose user is undefined — the page crashed rendering its name.
      .filter(w => w.event != null && w.user != null)

    return NextResponse.json({ attendees, waitlist })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
