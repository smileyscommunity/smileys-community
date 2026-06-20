import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const today = new Date().toISOString().split('T')[0]

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
