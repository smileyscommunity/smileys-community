import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const attendees = await prisma.eventAttendee.findMany({
      where: {
        status: 'approved',
        event: { clubId: club.id, status: { in: ['published', 'archived'] } },
      },
      select: {
        userId: true,
        user: { select: { id: true, name: true, color: true, profilePhoto: true } },
      },
    })

    const countMap = new Map<string, { user: typeof attendees[0]['user']; count: number }>()
    for (const a of attendees) {
      const entry = countMap.get(a.userId)
      if (entry) { entry.count++ }
      else { countMap.set(a.userId, { user: a.user, count: 1 }) }
    }

    const leaderboard = [...countMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map((entry, i) => ({ rank: i + 1, ...entry }))

    return NextResponse.json({ leaderboard })
  } catch (e) {
    console.error('[club leaderboard GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
