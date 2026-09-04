import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { resolveCityId, getCityConfig } from '@/lib/city'
import { countryName } from '@/lib/country'

const COORD_PATTERNS = [
  /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
  /ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
]

const ALLOWED_HOSTS = ['maps.google.com', 'www.google.com', 'maps.app.goo.gl', 'goo.gl', 'maps.apple.com']

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

async function geocodeQuery(q: string): Promise<{ lat: string; lon: string } | null> {
  try {
    const nominatim = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=tr`,
      { headers: { 'User-Agent': 'SmileysCommunitApp/1.0 (info@smileyscommunity.com)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(4000) }
    )
    const data = await nominatim.json()
    if (Array.isArray(data) && data[0]) return { lat: data[0].lat, lon: data[0].lon }
  } catch {}

  try {
    const photon = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lang=en&bbox=25.9,36.0,44.8,42.1`,
      { signal: AbortSignal.timeout(4000) }
    )
    const data = await photon.json()
    const feature = data?.features?.[0]
    if (feature) {
      const [lon, lat] = feature.geometry.coordinates
      return { lat: String(lat), lon: String(lon) }
    }
  } catch {}

  return null
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
        // Anchor the place name in the city being administered — this used to
        // say "Istanbul, Turkey" for every city's venues.
        const city   = await getCityConfig(await resolveCityId(session))
        const result = await geocodeQuery(`${name}, ${city.name}, ${countryName(city.country)}`)
        if (result) return NextResponse.json([result])
      }
    } catch {}
    return NextResponse.json([])
  }

  // Address geocoding mode
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  const result = await geocodeQuery(q)
  return NextResponse.json(result ? [result] : [])
}
