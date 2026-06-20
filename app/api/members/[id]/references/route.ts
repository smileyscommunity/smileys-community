import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const refs = await prisma.hangoutReference.findMany({
      where: { toUserId: id, vibe: 'good' },
      select: {
        id:        true,
        createdAt: true,
        fromUser:  { select: { id: true, name: true, color: true } },
        hangout:   { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return NextResponse.json(refs)
  } catch (e) {
    console.error('[members references GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
