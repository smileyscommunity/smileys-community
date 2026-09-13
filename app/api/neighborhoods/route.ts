import { NextRequest, NextResponse } from 'next/server'
import { resolvePublicCityIdFromSlug } from '@/lib/cities'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { getNeighborhoodsForCity } from '@/lib/neighborhoodsDb'
import { rateLimit, getIp } from '@/lib/rateLimit'

// The viewer's city's neighborhood list — feeds form selects (post a listing,
// set your neighborhood, plan a hangout) so they stop importing the hardcoded
// Istanbul constant and start serving each member their own city's list.
// Public: the same names already render on public cards and filters.
export async function GET(req: NextRequest) {
  const ip = getIp(req)
  if (!await rateLimit(`neighborhoods:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const session = await getSession()
  // ?city=<slug> serves another city's list (destination pickers); unknown
  // slugs fail closed to an empty list. Default: the viewer's city.
  let cityId: string
  const citySlug = req.nextUrl.searchParams.get('city')?.trim()
  if (citySlug) {
    cityId = await resolvePublicCityIdFromSlug(citySlug)
  } else {
    cityId = await resolveCityId(session)
  }
  const neighborhoods = await getNeighborhoodsForCity(cityId)
  // Only the ?city= form may be cached publicly — its URL names the city, so
  // the 60s cache (mirroring the helper's in-memory TTL) is keyed correctly.
  // The bare form answers from the view-city cookie / session behind one URL,
  // and caching it publicly served the previous city's names for minutes
  // after a city switch (and could hand one viewer's list to another).
  return NextResponse.json({ neighborhoods }, {
    headers: citySlug
      ? { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' }
      : { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
  })
}
