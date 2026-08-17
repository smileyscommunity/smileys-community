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
import { NEIGHBORHOOD_META } from './neighborhoods'
import { getCityConfig, DEFAULT_CITY_SLUG } from './city'

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

/**
 * The one rule every write path that sets `User.neighborhood` must apply.
 *
 * A member's neighborhood is matched BY NAME against their city's registry by
 * every neighborhood feature, so a value that isn't in it silently excludes
 * them from all of them — their own neighborhood page, "members near you",
 * neighborhood event matching — while the profile still looks filled in. That
 * failure never gets reported, because nothing looks broken.
 *
 * Prod had 33 such rows before this existed (repaired by
 * scripts/fix-member-neighborhoods.ts): empty strings stored as values,
 * diacritics stripped by hand-typed input, and members holding another city's
 * district. This closes the door those came through.
 *
 * Blank (null / '' / whitespace) clears the field — members must be able to
 * unset it. Anything else has to be a real, active neighborhood of THIS city;
 * an unrecognised value is an error rather than a silently dropped one, so the
 * caller learns at the point the bad value is introduced.
 */
export type NeighborhoodInput =
  | { ok: true;  value: string | null }
  | { ok: false; error: string }

export async function normalizeNeighborhoodInput(cityId: string, raw: unknown): Promise<NeighborhoodInput> {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'Neighborhood must be text' }
  const name = raw.trim()
  if (!name) return { ok: true, value: null }
  if (name.length > 200) return { ok: false, error: 'Neighborhood is too long' }
  const safe = await safeNeighborhoodFor(cityId, name)
  if (!safe) return { ok: false, error: 'Pick a neighborhood from your city' }
  return { ok: true, value: safe }
}

// ── The render shape ────────────────────────────────────────────────────────
// What a neighborhood page/card needs, with the editorial layer already
// merged in. `area` is the city's own grouping vocabulary — Istanbul's
// European/Asian/Coastal…, someone else's something entirely — so treat it
// as an opaque label, never as a known set. '' means the city hasn't grouped
// its neighborhoods at all, which must render as "no grouping", not as a
// missing Istanbul side.
export interface NeighborhoodView {
  name:  string
  slug:  string
  emoji: string
  vibe:  string
  area:  string
  cost:  number
  lat:   number
  lon:   number
}

// NEIGHBORHOOD_META is Istanbul's hand-authored editorial layer (vibes,
// coordinates, cost tiers written by members). It's keyed by bare name, so it
// may only be applied to the DEFAULT city — otherwise a second city that
// happens to name a district "Merkez" or "Centre" would silently inherit
// Istanbul's copy and Istanbul's latitude.
function toView(row: CityNeighborhood, editorial: boolean): NeighborhoodView {
  const meta = editorial ? NEIGHBORHOOD_META[row.name] : undefined
  return {
    name:  row.name,
    slug:  row.slug,
    emoji: meta?.emoji ?? row.emoji,
    vibe:  meta?.vibe  ?? row.vibe ?? '',
    area:  meta?.side  ?? row.area ?? '',
    cost:  meta?.cost  ?? row.cost,
    lat:   meta?.lat   ?? row.lat ?? 0,
    lon:   meta?.lon   ?? row.lng ?? 0,
  }
}

/** Every neighborhood of a city, ready to render. */
export async function getNeighborhoodViews(cityId: string): Promise<NeighborhoodView[]> {
  const [rows, cfg] = await Promise.all([getNeighborhoodsForCity(cityId), getCityConfig(cityId)])
  const editorial = cfg.slug === DEFAULT_CITY_SLUG
  return rows.map(r => toView(r, editorial))
}

/** One neighborhood of a city by slug, or null — the per-city replacement for
 *  slugToNeighborhood + getNeighborhoodMeta. */
export async function getNeighborhoodView(cityId: string, slug: string): Promise<NeighborhoodView | null> {
  return (await getNeighborhoodViews(cityId)).find(n => n.slug === slug) ?? null
}
