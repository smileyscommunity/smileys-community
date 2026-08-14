import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CITY_STATUS } from '@/lib/cityStatus'
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
    // Every publicly-visible city, including `coming_soon`: registering
    // interest in a city that hasn't launched IS the "Get notified" path from
    // the homepage city cards, so it has to be selectable on the apply form.
    // Only `paused` is withheld.
    where:   { status: { in: [CITY_STATUS.Live, CITY_STATUS.Preparing, CITY_STATUS.ComingSoon] } },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select:  { slug: true, name: true, country: true, status: true },
  })
  setCached(CACHE_KEY, cities, TTL_MS)
  return NextResponse.json(cities, { headers: { 'X-Cache': 'MISS' } })
}
