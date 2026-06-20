import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost } from '@/lib/access'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = isAdmin(session)
    const host  = !admin && await isClubHost(session.id)

    if (!admin && !host) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const hostId = session.id

    // Same event scope as /api/host/events: own events + co-hosted + club events
    const hostClubs = await prisma.clubMembership.findMany({
      where: { userId: hostId, role: 'host', status: 'approved' },
      select: { clubId: true },
    })
    const clubIds = hostClubs.map(m => m.clubId)

    const eventWhere = {
      OR: [
        { hostId },
        ...(clubIds.length > 0 ? [{ clubId: { in: clubIds } }] : []),
      ],
    }

    const [events, reviews, attendeeStats] = await Promise.all([
      prisma.event.count({ where: eventWhere }),

      prisma.review.aggregate({
        where: { event: eventWhere },
        _avg: { rating: true },
        _count: { rating: true },
      }),

      prisma.eventAttendee.findMany({
        where: { event: eventWhere, status: 'approved' },
        select: { userId: true },
      }),
    ])

    const totalAttendees = attendeeStats.length
    const uniqueMembers  = new Set(attendeeStats.map(a => a.userId)).size
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
