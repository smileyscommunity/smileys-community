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

    const [events, reviews, attendeeStats] = await Promise.all([
      // Total events count
      prisma.event.count({ where: { hostId } }),
      
      // Average rating across all events hosted by this user
      prisma.review.aggregate({
        where: { event: { hostId } },
        _avg: { rating: true },
        _count: { rating: true }
      }),

      // Total attendees and unique members reached
      prisma.eventAttendee.findMany({
        where: { event: { hostId }, status: 'approved' },
        select: { userId: true }
      })
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
