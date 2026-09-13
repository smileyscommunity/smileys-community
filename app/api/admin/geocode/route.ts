import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isModerator, isClubHost, hostCityIds } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { resolveCityId, getCityConfig } from '@/lib/city'
import { countryName, countryCodeFor } from '@/lib/country'

const COORD_PATTERNS = [
  /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
  /ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
]

const ALLOWED_HOSTS = ['maps.google.com', 'www.google.com', 'maps.app.goo.gl', 'goo.gl', 'maps.apple.com']

// Both upstreams are free services with usage policies (Nominatim allows about
// one request a second per application), and every lookup here is proxied
// through our one server address — so each user gets a budget.
const GEOCODE_LIMIT     = 30
const GEOCODE_WINDOW_MS = 10 * 60_000

type GeoCity = { name: string; country: string | null; lat: number | null; lng: number | null }

// Manually follow redirects (up to 5 hops) and re-check each hop's host against the
// allowlist. Prevents shortener URLs from redirecting fetch into internal services
// like http://localhost:6379 (SSRF).
async function safeFollowRedirects(startUrl: string): Promise<string | null> {
  let current = startUrl
  for (let hop = 0; hop < 5; hop++) {
    let host: string
    try { host = new URL(current).hostname } catch { return null }
    if (!ALLOWED_HOSTS.includes(host)) return null
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(4000) })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return current
      current = new URL(loc, current).toString()
      continue
    }
    return current
  }
  return null
}

// The city a lookup belongs to: the event's, when the form names it
// (?city=<slug> or ?cityId=<id>), else the city the viewer is working in.
// A named city that doesn't exist is null — search unrestricted — rather
// than getCityConfig's default-city fallback, which would quietly reinstate
// the one-country search this replaced.
async function lookupCity(req: NextRequest, session: { cityId?: string }): Promise<GeoCity | null> {
  const select = { name: true, country: true, lat: true, lng: true }
  const slug   = req.nextUrl.searchParams.get('city')?.trim()
  if (slug) return /^[a-z0-9-]{1,40}$/.test(slug) ? prisma.city.findFirst({ where: { slug }, select }) : null
  const id = req.nextUrl.searchParams.get('cityId')?.trim()
  if (id) return id.length <= 64 ? prisma.city.findFirst({ where: { id }, select }) : null
  return getCityConfig(await resolveCityId(session))
}

async function geocodeQuery(q: string, city: GeoCity | null): Promise<{ lat: string; lon: string } | null> {
  // Limit to the city's country. This was a hardcoded single-country filter
  // (and a matching Photon bounding box), so a Tbilisi venue could never be
  // found. Unknown country → no restriction at all.
  const cc = countryCodeFor(city?.country)

  try {
    const params = new URLSearchParams({ q, format: 'json', limit: '1' })
    if (cc) params.set('countrycodes', cc.toLowerCase())
    const nominatim = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { 'User-Agent': 'SmileysCommunitApp/1.0 (info@smileyscommunity.com)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(4000) }
    )
    const data = await nominatim.json()
    if (Array.isArray(data) && data[0]) return { lat: data[0].lat, lon: data[0].lon }
  } catch {}

  try {
    // Photon has no country filter: bias toward the city centre and keep the
    // first result in the right country.
    const params = new URLSearchParams({ q, limit: cc ? '5' : '1', lang: 'en' })
    if (city?.lat != null && city?.lng != null) {
      params.set('lat', String(city.lat))
      params.set('lon', String(city.lng))
    }
    const photon = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: AbortSignal.timeout(4000) })
    const data = await photon.json()
    const features: { geometry?: { coordinates?: [number, number] }; properties?: { countrycode?: string } }[] =
      Array.isArray(data?.features) ? data.features : []
    const feature = cc
      ? features.find(f => String(f?.properties?.countrycode ?? '').toUpperCase() === cc)
      : features[0]
    if (feature?.geometry?.coordinates) {
      const [lon, lat] = feature.geometry.coordinates
      return { lat: String(lat), lon: String(lon) }
    }
  } catch {}

  return null
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // The host event forms call this too, and it was admin-only — so every host
  // got "no location found" on a real address. Same people who may create an
  // event (the host events routes and /describe): staff, club hosts, city hosts.
  const canUse = isAdmin(session) || isModerator(session) || await isClubHost(session.id) || (await hostCityIds(session.id)).length > 0
  if (!canUse) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!await rateLimit(`geocode:${session.id}`, GEOCODE_LIMIT, GEOCODE_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many location lookups — try again in a few minutes' }, { status: 429 })
  }

  // URL resolution mode — follow redirect then extract coords
  const url = req.nextUrl.searchParams.get('url')?.trim()
  if (url) {
    try {
      const resolved = await safeFollowRedirects(url)
      if (!resolved) return NextResponse.json([])

      // Try to extract coordinates directly from resolved URL
      for (const re of COORD_PATTERNS) {
        const m = resolved.match(re)
        if (m) return NextResponse.json([{ lat: m[1], lon: m[2] }])
      }

      // Extract place name and geocode it
      const placeMatch = resolved.match(/\/maps\/place\/([^/@?]+)/)
      if (placeMatch) {
        const name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '))
        // Anchor the place name in the event's city — this used to name the
        // founding city and country for every city's venues.
        const city   = await lookupCity(req, session)
        const result = await geocodeQuery([name, city?.name, countryName(city?.country)].filter(Boolean).join(', '), city)
        if (result) return NextResponse.json([result])
      }
    } catch {}
    return NextResponse.json([])
  }

  // Address geocoding mode
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  const result = await geocodeQuery(q, await lookupCity(req, session))
  return NextResponse.json(result ? [result] : [])
}
