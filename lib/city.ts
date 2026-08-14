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
