import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCityTz } from '@/lib/city'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { getSession } from '@/lib/session'
import { canActInCity } from '@/lib/access'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, cityId: true, isActive: true, isPrivate: true } })
    if (!club || !club.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // A private club's past is for its members and the city's staff, like its wall.
    if (club.isPrivate) {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (!canActInCity(session, club.cityId)) {
        const m = await prisma.clubMembership.findUnique({ where: { userId_clubId: { userId: session.id, clubId: club.id } }, select: { status: true } })
        if (m?.status !== 'approved') return NextResponse.json({ error: 'Members only' }, { status: 403 })
      }
    }

    // The club city's calendar, same as getEventsByClub — a UTC "today"
    // here made events fall out of BOTH the upcoming and past lists
    // between midnight and 03:00 on the city's clock.
    const today = todayInTz(club.cityId ? await getCityTz(club.cityId) : DEFAULT_TZ)

    const events = await prisma.event.findMany({
      where: {
        clubId: club.id,
        date: { lt: today },
        status: { in: ['published', 'archived', 'cancelled'] },
      },
      orderBy: { date: 'desc' },
      take: 50,
      select: {
        id: true, title: true, date: true, location: true,
        emoji: true, coverImage: true, status: true,
        _count: { select: { attendees: { where: { status: 'approved' } } } },
        reviews: { select: { rating: true } },
      },
    })

    return NextResponse.json({ events })
  } catch (e) {
    console.error('[club past-events GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
