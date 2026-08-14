// ── DB-backed per-city neighborhood registry (server only) ──────────────────
// Split out of lib/neighborhoods.ts deliberately: that module is imported by
// CLIENT components (EventCard, BottomNav via lib/data.ts) for pure helpers
// like neighborhoodToSlug. Importing `prisma` there drags the Postgres driver
// into the client bundle, and the build fails resolving `fs`/`tls` — which is
// exactly what happened when these helpers first landed there.
//
// Rule of thumb: lib/neighborhoods.ts stays pure and client-safe; anything
// that touches the database lives here.
//
// The neighborhoods table is the source of truth for which neighborhoods a
// city has; the NEIGHBORHOOD_META constant in lib/neighborhoods.ts remains as (a) Istanbul's
// seed data and (b) the editorial layer (images, guide copy) until per-city
// content ships. Server code validating or listing neighborhoods should use
// these helpers; the constant stays only for Istanbul-facing UI selects.
//
// Cached per city for 60s in module memory — neighborhood lists change at
// admin-edit cadence, and validation sits on hot write paths.

import { prisma } from './prisma'

export interface CityNeighborhood {
  id:    string
  name:  string
  slug:  string
  emoji: string
  vibe:  string | null
  area:  string | null
  cost:  number
  lat:   number | null
  lng:   number | null
}

const CACHE_TTL_MS = 60_000
const cityCache = new Map<string, { rows: CityNeighborhood[]; expires: number }>()

export async function getNeighborhoodsForCity(cityId: string): Promise<CityNeighborhood[]> {
  const hit = cityCache.get(cityId)
  if (hit && hit.expires > Date.now()) return hit.rows
  const rows = await prisma.neighborhood.findMany({
    where:   { cityId, active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select:  { id: true, name: true, slug: true, emoji: true, vibe: true, area: true, cost: true, lat: true, lng: true },
  })
  cityCache.set(cityId, { rows, expires: Date.now() + CACHE_TTL_MS })
  return rows
}

// Write-path validation: is `name` a real neighborhood of this city? Replaces
// the hardcoded `ISTANBUL_NEIGHBORHOODS.includes(...)` checks so a second
// city's members validate against THEIR list, not Istanbul's.
export async function isValidNeighborhoodFor(cityId: string, name: unknown): Promise<boolean> {
  if (typeof name !== 'string' || !name) return false
  const rows = await getNeighborhoodsForCity(cityId)
  return rows.some(n => n.name === name)
}

// Same contract as the old slugToNeighborhood, but per city.
export async function slugToNeighborhoodFor(cityId: string, slug: string): Promise<string | undefined> {
  const rows = await getNeighborhoodsForCity(cityId)
  return rows.find(n => n.slug === slug)?.name
}

// Drop-in replacement for the old `ISTANBUL_NEIGHBORHOODS.includes` ternaries:
// returns the name when it's a real neighborhood of the city, else null.
export async function safeNeighborhoodFor(cityId: string, name: unknown): Promise<string | null> {
  return (await isValidNeighborhoodFor(cityId, name)) ? (name as string) : null
}
