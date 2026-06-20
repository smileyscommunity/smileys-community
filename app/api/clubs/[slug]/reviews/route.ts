import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
    if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const reviews = await prisma.review.findMany({
      where: { event: { clubId: club.id } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        text: true,
        createdAt: true,
        user:  { select: { id: true, name: true, color: true, profilePhoto: true } },
        event: { select: { id: true, title: true } },
      },
    })

    return NextResponse.json({ reviews })
  } catch (e) {
    console.error('[club reviews GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
