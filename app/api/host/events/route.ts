import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost } from '@/lib/access'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isAdmin(session) && !await isClubHost(session.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get all clubs where user is a host
    const hostClubs = await prisma.clubMembership.findMany({
      where: { userId: session.id, role: 'host', status: 'approved' },
      select: { clubId: true },
    })
    const clubIds = hostClubs.map(m => m.clubId)

    // Show events they're personally hosting, co-hosting, OR events in their host clubs
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { hostId: session.id },
          { cohosts: { some: { userId: session.id } } },
          ...(clubIds.length > 0 ? [{ clubId: { in: clubIds } }] : []),
        ],
      },
      orderBy: { date: 'asc' },
      select: {
        id: true, title: true, date: true, time: true, location: true,
        status: true, emoji: true, totalSpots: true, coverImage: true,
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
    })

    return NextResponse.json(events)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
