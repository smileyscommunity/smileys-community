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
// ── Viewing city (the member-facing city selector) ──────────────────────────
//
// A member's HOME city is fixed (User.cityId). The city they're currently
// LOOKING AT is a cookie, so "show me Athens" is a view change, not a state
// change — no membership required, instantly reversible, and it costs nothing
// if they never touch it.
//
// It deliberately hooks in at resolveCityId, the single chokepoint every
// city-scoped feed already calls, so one change makes events, clubs, the board,
// hangouts and the rest follow the selector together instead of drifting apart.
//
// What it must NEVER do is affect authorization. Permission checks read
// session.cityId directly (canActInCity in lib/access.ts), so a moderator who
// switches their view to Athens still moderates only their own city. Content
// scoping and authority are separate on purpose — keep them that way.
export const VIEW_CITY_COOKIE = 'smileys_city'

// slug → id for live cities only, cached briefly. This sits on every
// city-scoped request, so it must not cost a query each time.
const liveCityCache = new Map<string, { id: string | null; expires: number }>()
const LIVE_TTL_MS = 60_000

async function liveCityIdBySlug(slug: string): Promise<string | null> {
  const hit = liveCityCache.get(slug)
  if (hit && hit.expires > Date.now()) return hit.id
  const city = await prisma.city.findFirst({
    where:  { slug, status: 'live' },
    select: { id: true },
  })
  const id = city?.id ?? null
  liveCityCache.set(slug, { id, expires: Date.now() + LIVE_TTL_MS })
  return id
}

/**
 * The city the current request is viewing, or null for "wherever I belong".
 *
 * Only `live` cities resolve: a stale cookie naming a paused or pre-launch city
 * falls back to the member's own rather than emptying every feed.
 */
export async function getViewCityId(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers')
    const slug = (await cookies()).get(VIEW_CITY_COOKIE)?.value?.trim()
    if (!slug) return null
    return await liveCityIdBySlug(slug)
  } catch {
    // cookies() throws outside a request scope (e.g. inside unstable_cache or
    // at build time). Falling back is correct there — nobody is "viewing".
    return null
  }
}

export async function resolveCityId(session: { cityId?: string } | null | undefined): Promise<string> {
  return (await getViewCityId()) ?? session?.cityId ?? getDefaultCityId()
}

// What a page header needs to know about the city a feed resolved to:
// its name, whether it's the default, and — when the view-city cookie is
// pointing somewhere other than the viewer's own city — the home city to
// offer a "back to X" switch for. Without that switch the year-long
// cookie is a trap: one click into İzmir pinned every feed there.
export interface ResolvedCityInfo {
  name: string
  slug: string
  isDefault: boolean
  viewing: boolean          // true when the cookie moved this viewer off their own city
  homeName: string | null   // the city "back" returns to; null unless viewing
}

export async function describeCity(
  cityId: string,
  session: { cityId?: string } | null | undefined,
): Promise<ResolvedCityInfo> {
  const cfg    = await getCityConfig(cityId)
  const homeId = session?.cityId ?? await getDefaultCityId()
  const viewing = (await getViewCityId()) === cityId && cityId !== homeId
  return {
    name:      cfg.name,
    slug:      cfg.slug,
    isDefault: cfg.slug === DEFAULT_CITY_SLUG,
    viewing,
    homeName:  viewing ? (await getCityConfig(homeId)).name : null,
  }
}

// ── Per-city config (timezone/currency), cached ─────────────────────────────
// Server-side companion to lib/cityTime.ts: cityId → the config a request
// needs to compute that city's "today" or format its prices. 5-minute TTL —
// timezone/currency effectively never change, but unlike the default-city id
// they CAN (admin fixes a typo, as already happened with Izmir's 'EUROPE'),
// so the cache must eventually notice without a restart.
// `country` is the ISO 3166-1 alpha-2 code the admin form collects, not a
// display name — run it through countryName() before showing it to anyone.
// `showGlobalClubs` rides along here rather than costing getClubs() its own
// query per grid render: the club listing needs it on every request, and it
// changes about as often as the timezone does.
// `heroImage` is here for the same reason: shared surfaces (/neighborhoods and
// friends) hardcoded Istanbul's photo, which is a leak on every other city's
// page, and they already hold a CityConfig.
export interface CityConfig { timezone: string; currency: string; slug: string; name: string; country: string; showGlobalClubs: boolean; heroImage: string | null }

const CONFIG_TTL_MS = 5 * 60_000
const configCache = new Map<string, { cfg: CityConfig; expires: number }>()

export async function getCityConfig(cityId: string): Promise<CityConfig> {
  const hit = configCache.get(cityId)
  if (hit && hit.expires > Date.now()) return hit.cfg
  const city = await prisma.city.findUnique({
    where:  { id: cityId },
    select: { timezone: true, currency: true, slug: true, name: true, country: true, showGlobalClubs: true, heroImage: true },
  })
  // Unknown id falls back to the default city's zone rather than throwing —
  // a stale cityId must degrade to Istanbul behavior, not a 500. That includes
  // showGlobalClubs: Istanbul shows them, so a stale id doesn't silently strip
  // the Culture and Language clubs out of the grid.
  const cfg: CityConfig = city ?? { timezone: 'Europe/Istanbul', currency: 'TRY', slug: DEFAULT_CITY_SLUG, name: 'Istanbul', country: 'TR', showGlobalClubs: true, heroImage: null }
  configCache.set(cityId, { cfg, expires: Date.now() + CONFIG_TTL_MS })
  return cfg
}

/** The IANA timezone a request's city runs on. */
export async function getCityTz(cityId: string): Promise<string> {
  return (await getCityConfig(cityId)).timezone
}
