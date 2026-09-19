import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost, hostCityIds } from '@/lib/access'
import { heldEvents, attendedSeatWhere } from '@/lib/hostStats'

// GET /api/host/impact — what the caller's own events have done: how many
// went ahead, how many guests came, and what those guests said in reviews.
// Only events that happened count, and only guests who came (lib/hostStats
// has the rules and why); it used to count future, pending and postponed
// events and every RSVP as a "Social Moment".
//
// Response: { eventsHeld, guestVisits, distinctGuests, averageRating, reviewCount }
//   eventsHeld      events hosted or co-hosted that went ahead and are over
//   guestVisits     seats at those events whose holder came (one person at
//                   three events is three) — the host and co-hosts excluded
//   distinctGuests  how many different people that was
//   averageRating   mean review rating on those events, 0 when none
//   reviewCount     how many reviews that mean is over
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = isAdmin(session)
    // Own-impact card, scoped to the caller's own (co-)hosted events below.
    // City-level hosts see theirs too — same reasoning as /api/host/events.
    const host  = !admin && (
      await isClubHost(session.id) || (await hostCityIds(session.id)).length > 0
    )

    if (!admin && !host) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const hostId = session.id

    // The host's OWN events: primary host or co-host. This used to OR
    // in every event of every club the caller hosts, so on multi-host
    // clubs each host's impact card silently counted the other hosts'
    // events, attendees, and reviews. /api/host/events already scopes
    // to hostId; this now matches (plus co-hosted, which reviews and
    // attendance legitimately credit to the co-host too).
    const held = await heldEvents({
      OR: [
        { hostId },
        { cohosts: { some: { userId: hostId } } },
      ],
    })
    if (held.length === 0) {
      return NextResponse.json({ eventsHeld: 0, guestVisits: 0, distinctGuests: 0, averageRating: 0, reviewCount: 0 })
    }
    const eventIds = held.map(e => e.id)

    const [reviews, seats] = await Promise.all([
      prisma.review.aggregate({
        where: { eventId: { in: eventIds } },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      // Rows, not a count: whoever ran a given event (host, co-hosts) is
      // staff in that room, not a guest, and that differs per event.
      prisma.eventAttendee.findMany({
        where:  { eventId: { in: eventIds }, ...attendedSeatWhere },
        select: { eventId: true, userId: true },
      }),
    ])

    const staff  = new Map(held.map(e => [e.id, new Set(e.staffIds)]))
    const guests = seats.filter(s => !staff.get(s.eventId)?.has(s.userId))

    return NextResponse.json({
      eventsHeld:     held.length,
      guestVisits:    guests.length,
      distinctGuests: new Set(guests.map(g => g.userId)).size,
      averageRating:  parseFloat((reviews._avg.rating ?? 0).toFixed(1)),
      reviewCount:    reviews._count.rating,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
