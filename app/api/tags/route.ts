import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCached, setCached } from '@/lib/analyticsCache'

const CACHE_KEY = 'tags:groups'
const TTL_MS    = 120_000  // 2 min — tag taxonomy changes only on admin edits

export async function GET() {
  try {
    const cached = getCached<unknown[]>(CACHE_KEY)
    if (cached) {
      return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } })
    }

    const groups = await prisma.tagGroup.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { tags: { orderBy: { name: 'asc' } } },
    })
    setCached(CACHE_KEY, groups, TTL_MS)
    return NextResponse.json(groups, { headers: { 'X-Cache': 'MISS' } })
  } catch (e) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
