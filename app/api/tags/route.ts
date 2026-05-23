import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const groups = await prisma.tagGroup.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        tags: { orderBy: { name: 'asc' } },
      },
    })
    return NextResponse.json(groups)
  } catch (e) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
