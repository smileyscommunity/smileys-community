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

    const events = await prisma.event.findMany({
      where: { hostId: session.id },
      orderBy: { date: 'asc' },
      select: {
        id: true, title: true, date: true, time: true, location: true,
        status: true, emoji: true, totalSpots: true, coverImage: true, hostId: true,
        _count: { select: { attendees: { where: { status: 'approved' } } } },
        attendees: { where: { status: 'approved', checkedIn: true }, select: { userId: true } },
      },
    })

    return NextResponse.json(events.map(({ attendees: checkedInList, hostId: _hostId, ...e }) => ({
      ...e,
      checkedInCount: checkedInList.length,
    })))
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
