// ── Cities: the multi-city spine (server) ───────────────────────────────────
// Smileys is one platform with many cities, not one site per city. Everything
// public that says "city" reads from here, so activating a city in the admin is
// the ONLY step needed to make it appear across the site — no code change, no
// deploy, no hard-coded list anywhere.
//
// Three modules, split along hard boundaries — keep them apart:
//   lib/cityStatus.ts  pure vocabulary + types. Safe in CLIENT components;
//                      importing prisma there breaks the browser bundle.
//   lib/city.ts        request scoping (which city is THIS request about).
//   lib/cities.ts      this file — the public catalogue and its statistics.
// The first two are re-exported here so server callers need one import.

import { prisma } from './prisma'
import { CITY_STATUS, isCityStatus, type CityStatus, type CityStats, type PublicCity } from './cityStatus'

export * from './cityStatus'
export { DEFAULT_CITY_SLUG, getDefaultCityId, resolveCityId } from './city'

// Cities a guest may see. Paused is excluded here so no public caller can leak
// one by forgetting the filter.
const PUBLIC_STATUSES: CityStatus[] = [CITY_STATUS.Live, CITY_STATUS.Preparing, CITY_STATUS.ComingSoon]

// Sort order for the city grid: live first, then preparing, then coming soon,
// each alphabetical. Keeps Istanbul at the top today without naming Istanbul.
const STATUS_RANK: Record<string, number> = {
  [CITY_STATUS.Live]:       0,
  [CITY_STATUS.Preparing]:  1,
  [CITY_STATUS.ComingSoon]: 2,
}

/**
 * Every city a guest may see, newest-status-first, with stats attached to the
 * live ones. One query for the cities plus three grouped counts — not N+1 per
 * city — so this stays cheap as cities are added.
 */
export async function getPublicCities(): Promise<PublicCity[]> {
  const cities = await prisma.city.findMany({
    where:  { status: { in: PUBLIC_STATUSES } },
    select: {
      id: true, slug: true, name: true, country: true, status: true,
      tagline: true, description: true, heroImage: true,
    },
  })

  const liveIds = cities.filter(c => c.status === CITY_STATUS.Live).map(c => c.id)
  const stats = liveIds.length ? await getStatsFor(liveIds) : new Map<string, CityStats>()

  return cities
    .map(c => ({
      ...c,
      status: (isCityStatus(c.status) ? c.status : CITY_STATUS.ComingSoon),
      stats:  stats.get(c.id) ?? null,
    }))
    .sort((a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      a.name.localeCompare(b.name),
    )
}

/** One city by slug, or null. Returns paused/unknown as null — same rule as the grid. */
export async function getPublicCity(slug: string): Promise<PublicCity | null> {
  const city = await prisma.city.findFirst({
    where:  { slug, status: { in: PUBLIC_STATUSES } },
    select: {
      id: true, slug: true, name: true, country: true, status: true,
      tagline: true, description: true, heroImage: true,
    },
  })
  if (!city) return null

  const status = isCityStatus(city.status) ? city.status : CITY_STATUS.ComingSoon
  const stats  = status === CITY_STATUS.Live ? (await getStatsFor([city.id])).get(city.id) ?? null : null
  return { ...city, status, stats }
}

// Grouped counts for the given cities in three queries total. `today` is
// compared as a string because Event.date is stored as text 'YYYY-MM-DD'.
async function getStatsFor(cityIds: string[]): Promise<Map<string, CityStats>> {
  const today = new Date().toISOString().split('T')[0]

  const [members, clubs, events] = await Promise.all([
    prisma.user.groupBy({
      by: ['cityId'],
      where: { cityId: { in: cityIds }, status: 'approved' },
      _count: { _all: true },
    }),
    prisma.club.groupBy({
      by: ['cityId'],
      where: { cityId: { in: cityIds }, isActive: true },
      _count: { _all: true },
    }),
    prisma.event.groupBy({
      by: ['cityId'],
      where: { cityId: { in: cityIds }, status: 'published', date: { gte: today } },
      _count: { _all: true },
    }),
  ])

  const out = new Map<string, CityStats>()
  for (const id of cityIds) {
    out.set(id, {
      members: members.find(m => m.cityId === id)?._count._all ?? 0,
      clubs:   clubs.find(c => c.cityId === id)?._count._all   ?? 0,
      events:  events.find(e => e.cityId === id)?._count._all  ?? 0,
    })
  }
  return out
}
