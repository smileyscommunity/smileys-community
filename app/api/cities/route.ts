import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCached, setCached } from '@/lib/analyticsCache'

const CACHE_KEY = 'cities:live'
const TTL_MS    = 60_000  // 60s — cities change rarely; stale for a minute is fine

// Public listing of cities that accept applications today. Paused
// cities are filtered out so the apply form doesn't surface a city
// nobody can join. Status carried through so a "Launching ✦" badge
// can render next to early-stage cities once the front-end wants it.
export async function GET() {
  const cached = getCached<unknown[]>(CACHE_KEY)
  if (cached) {
    return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } })
  }

  const cities = await prisma.city.findMany({
    where:   { status: { in: ['live', 'launching'] } },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select:  { slug: true, name: true, country: true, status: true },
  })
  setCached(CACHE_KEY, cities, TTL_MS)
  return NextResponse.json(cities, { headers: { 'X-Cache': 'MISS' } })
}
