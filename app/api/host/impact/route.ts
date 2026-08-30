import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost, hostCityIds } from '@/lib/access'

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
    const eventWhere = {
      OR: [
        { hostId },
        { cohosts: { some: { userId: hostId } } },
      ],
    }

    const [events, reviews, totalAttendees, uniqueGroups] = await Promise.all([
      prisma.event.count({ where: eventWhere }),

      prisma.review.aggregate({
        where: { event: eventWhere },
        _avg: { rating: true },
        _count: { rating: true },
      }),

      // Total approved attendances (count, not row fetch).
      prisma.eventAttendee.count({
        where: { event: eventWhere, status: 'approved' },
      }),

      // Distinct members: one row per unique userId instead of loading
      // every attendance row to build a Set in memory.
      prisma.eventAttendee.groupBy({
        by: ['userId'],
        where: { event: eventWhere, status: 'approved' },
      }),
    ])

    const uniqueMembers  = uniqueGroups.length
    const averageRating  = reviews._avg.rating ?? 0
    const reviewCount    = reviews._count.rating

    return NextResponse.json({
      eventsHosted: events,
      totalAttendees,
      uniqueMembers,
      averageRating: parseFloat(averageRating.toFixed(1)),
      reviewCount
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
