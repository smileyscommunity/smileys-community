import { prisma } from './prisma'

// ── City scoping (multi-city phase 1) ───────────────────────────────────────
// Every feed with a location dimension is scoped to exactly one city. Members
// are scoped to their own cityId (already on the session, injected live from
// the DB). Guests have no cityId, so public surfaces fall back to the default
// city — Istanbul, the only live city — until the city selector ships and
// public pages carry an explicit city context.

export const DEFAULT_CITY_SLUG = 'istanbul'

// The default city's id never changes for the lifetime of a deployment, so
// cache it in module memory after the first lookup (mirrors the 60s cache on
// /api/cities, but this value is immutable — no TTL needed).
let defaultCityId: string | null = null

export async function getDefaultCityId(): Promise<string> {
  if (defaultCityId) return defaultCityId
  const city = await prisma.city.findUnique({
    where: { slug: DEFAULT_CITY_SLUG },
    select: { id: true },
  })
  if (!city) throw new Error(`Default city '${DEFAULT_CITY_SLUG}' missing from cities table`)
  defaultCityId = city.id
  return city.id
}

// The city a request is scoped to: the viewer's own city when signed in,
// the default city for guests. Takes the session structurally so callers
// don't need the Session type.
export async function resolveCityId(session: { cityId?: string } | null | undefined): Promise<string> {
  return session?.cityId ?? getDefaultCityId()
}

// ── Per-city config (timezone/currency), cached ─────────────────────────────
// Server-side companion to lib/cityTime.ts: cityId → the config a request
// needs to compute that city's "today" or format its prices. 5-minute TTL —
// timezone/currency effectively never change, but unlike the default-city id
// they CAN (admin fixes a typo, as already happened with Izmir's 'EUROPE'),
// so the cache must eventually notice without a restart.
export interface CityConfig { timezone: string; currency: string; slug: string; name: string }

const CONFIG_TTL_MS = 5 * 60_000
const configCache = new Map<string, { cfg: CityConfig; expires: number }>()

export async function getCityConfig(cityId: string): Promise<CityConfig> {
  const hit = configCache.get(cityId)
  if (hit && hit.expires > Date.now()) return hit.cfg
  const city = await prisma.city.findUnique({
    where:  { id: cityId },
    select: { timezone: true, currency: true, slug: true, name: true },
  })
  // Unknown id falls back to the default city's zone rather than throwing —
  // a stale cityId must degrade to Istanbul behavior, not a 500.
  const cfg: CityConfig = city ?? { timezone: 'Europe/Istanbul', currency: 'TRY', slug: DEFAULT_CITY_SLUG, name: 'Istanbul' }
  configCache.set(cityId, { cfg, expires: Date.now() + CONFIG_TTL_MS })
  return cfg
}

/** The IANA timezone a request's city runs on. */
export async function getCityTz(cityId: string): Promise<string> {
  return (await getCityConfig(cityId)).timezone
}
