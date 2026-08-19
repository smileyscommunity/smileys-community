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

import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'
import { todayInTz, DEFAULT_TZ } from './cityTime'
import { CITY_STATUS, isCityStatus, type CityStatus, type CityStats, type PublicCity } from './cityStatus'
import { classifyCityMaturity } from './cityMaturity'

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
      tagline: true, description: true, heroImage: true, timezone: true,
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
      tagline: true, description: true, heroImage: true, timezone: true,
    },
  })
  if (!city) return null

  const status = isCityStatus(city.status) ? city.status : CITY_STATUS.ComingSoon
  const stats  = status === CITY_STATUS.Live ? (await getStatsFor([city.id])).get(city.id) ?? null : null
  return { ...city, status, stats }
}

// Grouped counts for the given cities. `today` is compared as a string
// because Event.date is stored as text 'YYYY-MM-DD'. Exported for the admin
// cities console, which needs the derived maturity as an ops signal.
export async function getStatsFor(cityIds: string[]): Promise<Map<string, CityStats>> {
  // Default-city calendar day, not UTC — between 00:00 and 03:00 Istanbul
  // the UTC date is still yesterday and the count would include finished
  // events. Per-city todays can come when stats span differing zones.
  const today = todayInTz(DEFAULT_TZ)

  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [members, clubs, events, hostedClubRows, hangouts] = await Promise.all([
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
    // Maturity signals. Hosted clubs can't come from groupBy (relation
    // filter), but the club list is small — fetch ids and count here.
    prisma.club.findMany({
      where: {
        cityId: { in: cityIds }, isActive: true,
        memberships: { some: { role: 'host', status: 'approved' } },
      },
      select: { cityId: true },
    }),
    prisma.hangout.groupBy({
      by: ['cityId'],
      where: { cityId: { in: cityIds }, createdAt: { gte: monthAgo } },
      _count: { _all: true },
    }),
  ])

  const out = new Map<string, CityStats>()
  for (const id of cityIds) {
    const s = {
      members: members.find(m => m.cityId === id)?._count._all ?? 0,
      clubs:   clubs.find(c => c.cityId === id)?._count._all   ?? 0,
      events:  events.find(e => e.cityId === id)?._count._all  ?? 0,
    }
    out.set(id, {
      ...s,
      maturity: classifyCityMaturity({
        members:           s.members,
        upcomingEvents:    s.events,
        hostedClubs:       hostedClubRows.filter(c => c.cityId === id).length,
        memberActivity30d: hangouts.find(h => h.cityId === id)?._count._all ?? 0,
      }),
    })
  }
  return out
}

// Cities for the nav, cached — the layout renders on EVERY page, so this must
// not cost a query per request. 60s is plenty: a city changes status about as
// often as someone edits it in the admin, and the nav catching up a minute
// later is invisible.
export const getNavCities = unstable_cache(
  async () => (await getPublicCities()).map(c => ({
    slug: c.slug, name: c.name, country: c.country, status: c.status,
  })),
  ['nav-cities'],
  { revalidate: 60, tags: ['cities'] },
)
