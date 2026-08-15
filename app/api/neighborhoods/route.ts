import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { getNeighborhoodsForCity } from '@/lib/neighborhoodsDb'
import { rateLimit } from '@/lib/rateLimit'

// The viewer's city's neighborhood list — feeds form selects (post a listing,
// set your neighborhood, plan a hangout) so they stop importing the hardcoded
// Istanbul constant and start serving each member their own city's list.
// Public: the same names already render on public cards and filters.
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anon'
  if (!await rateLimit(`neighborhoods:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const session = await getSession()
  // ?city=<slug> serves another city's list (destination pickers); unknown
  // slugs fail closed to an empty list. Default: the viewer's city.
  let cityId: string
  const citySlug = req.nextUrl.searchParams.get('city')?.trim()
  if (citySlug) {
    const { prisma } = await import('@/lib/prisma')
    const c = await prisma.city.findFirst({
      where: { slug: citySlug, status: { in: ['live', 'preparing'] } },
      select: { id: true },
    })
    cityId = c?.id ?? '__no_such_city__'
  } else {
    cityId = await resolveCityId(session)
  }
  const neighborhoods = await getNeighborhoodsForCity(cityId)
  // 60s edge cache mirrors the helper's in-memory TTL.
  return NextResponse.json({ neighborhoods }, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  })
}
