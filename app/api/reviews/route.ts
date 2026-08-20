import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { todayInCity, resolveCityId } from '@/lib/city'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const today = await todayInCity(await resolveCityId(session))

    const [attended, myReviews] = await Promise.all([
      prisma.eventAttendee.findMany({
        where: { userId: session.id, status: 'approved' },
        include: {
          event: { select: { id: true, title: true, emoji: true, date: true, coverImage: true } },
        },
      }),
      prisma.review.findMany({
        where: { userId: session.id },
        include: {
          event: { select: { id: true, title: true, emoji: true, date: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const reviewedEventIds = new Set(myReviews.map(r => r.eventId))

    const toReview = attended
      .filter(a => a.event.date < today && !reviewedEventIds.has(a.eventId))
      .sort((a, b) => b.event.date.localeCompare(a.event.date))
      .map(a => a.event)

    return NextResponse.json({ toReview, submitted: myReviews })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
