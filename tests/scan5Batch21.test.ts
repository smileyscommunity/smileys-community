import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 76, 78, 79: neighborhood lists cached across a city switch,
// location lookup closed to the hosts whose forms call it, and location
// lookup pinned to one country.
const read = (f: string) => readFileSync(f, 'utf8')

const p = vi.hoisted(() => ({
  city: { findFirst: vi.fn() },
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const limiter = vi.hoisted(() => ({ allow: true }))
const access  = vi.hoisted(() => ({ clubHost: false, cityHostOf: [] as string[] }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(async () => limiter.allow),
  getIp:     vi.fn(() => '203.0.113.9'),
}))
vi.mock('@/lib/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access')>()),
  isClubHost:  vi.fn(async () => access.clubHost),
  hostCityIds: vi.fn(async () => access.cityHostOf),
}))
vi.mock('@/lib/city', () => ({
  resolveCityId: vi.fn(async () => 'cookie-city'),
  getCityConfig: vi.fn(async () => ({ name: 'Viewer City', country: 'GR', lat: 37.98, lng: 23.73 })),
}))
vi.mock('@/lib/cities', () => ({
  resolvePublicCityIdFromSlug: vi.fn(async (slug: string) => (slug === 'izmir' ? 'izmir-id' : '__no_such_city__')),
}))
vi.mock('@/lib/neighborhoodsDb', () => ({
  getNeighborhoodsForCity: vi.fn(async (cityId: string) => [{ name: `hood-of-${cityId}` }]),
}))

import { GET as neighborhoodsGET } from '@/app/api/neighborhoods/route'
import { GET as geocodeGET } from '@/app/api/admin/geocode/route'
import { rateLimit } from '@/lib/rateLimit'
import { resolveCityId } from '@/lib/city'
import { countryCodeFor } from '@/lib/country'
import { geocodeFailureMessage } from '@/lib/geocodeError'

const req = (url: string) => ({ url, nextUrl: new URL(url), headers: new Headers() }) as never

const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  session.current = null
  limiter.allow = true
  access.clubHost = false
  access.cityHostOf = []
  p.city.findFirst.mockResolvedValue(null)
  // Never the real geocoders: every upstream call lands here.
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ json: async () => [{ lat: '41.7', lon: '44.8' }] }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('76. the neighborhood list is not shared-cached when it depends on the cookie', () => {
  it('the bare (cookie-resolved) form is private and uncacheable', async () => {
    session.current = { id: 'm1', role: 'member', cityId: 'home-city' }
    const res = await neighborhoodsGET(req('http://x/app/api/neighborhoods'))
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('private')
    expect(cc).toContain('no-store')
    expect(cc).not.toContain('public')
    expect(cc).not.toMatch(/max-age=[1-9]/)
    expect(res.headers.get('vary')).toMatch(/Cookie/i)
    expect(resolveCityId).toHaveBeenCalled()
    expect((await res.json()).neighborhoods).toEqual([{ name: 'hood-of-cookie-city' }])
  })

  it('?city=<slug> is honoured over the cookie and keeps its public cache (the URL names the city)', async () => {
    const res = await neighborhoodsGET(req('http://x/app/api/neighborhoods?city=izmir'))
    expect(resolveCityId).not.toHaveBeenCalled()
    expect((await res.json()).neighborhoods).toEqual([{ name: 'hood-of-izmir-id' }])
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300')
  })

  it('the client hook never reads the bare form from the HTTP cache', () => {
    const hook = read('hooks/useCityNeighborhoods.ts')
    expect(hook).toMatch(/cache: city \? 'default' : 'no-store'/)
  })
})

describe('78. hosts can look up locations; members and guests cannot', () => {
  const lookup = () => geocodeGET(req('http://x/app/api/admin/geocode?q=Rustaveli+Ave+1'))

  it('a guest gets 401 and nothing upstream is called', async () => {
    const res = await lookup()
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a plain member gets 403 and nothing upstream is called', async () => {
    session.current = { id: 'm1', role: 'member', cityId: 'c1' }
    const res = await lookup()
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('a club host gets coordinates', async () => {
    session.current = { id: 'h1', role: 'member', cityId: 'c1' }
    access.clubHost = true
    const res = await lookup()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ lat: '41.7', lon: '44.8' }])
  })

  it('a city host (no club) and a moderator get coordinates too', async () => {
    session.current = { id: 'h2', role: 'member', cityId: 'c1' }
    access.cityHostOf = ['c1']
    expect((await lookup()).status).toBe(200)
    session.current = { id: 'mod', role: 'moderator', cityId: 'c1' }
    access.cityHostOf = []
    expect((await lookup()).status).toBe(200)
  })

  it('is rate limited per user, and a limited call is 429 without an upstream request', async () => {
    session.current = { id: 'h1', role: 'member', cityId: 'c1' }
    access.clubHost = true
    limiter.allow = false
    const res = await lookup()
    expect(res.status).toBe(429)
    expect(rateLimit).toHaveBeenCalledWith('geocode:h1', expect.any(Number), expect.any(Number))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the URL mode is behind the same gate and limit', async () => {
    session.current = { id: 'm1', role: 'member', cityId: 'c1' }
    expect((await geocodeGET(req('http://x/app/api/admin/geocode?url=https%3A%2F%2Fmaps.app.goo.gl%2Fabc'))).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the form message names the refusal instead of "no location found"', () => {
    expect(geocodeFailureMessage(200)).toBeNull()
    expect(geocodeFailureMessage(401)).toMatch(/sign in/i)
    expect(geocodeFailureMessage(403)).toMatch(/can't use location lookup/i)
    expect(geocodeFailureMessage(429)).toMatch(/too many/i)
    expect(geocodeFailureMessage(502)).toMatch(/502/)
    for (const s of [401, 403, 429, 500]) expect(geocodeFailureMessage(s)).not.toMatch(/no location found/i)
  })

  it.each([
    'app/host/events/new/page.tsx',
    'app/host/events/[id]/edit/page.tsx',
    'app/admin/events/new/page.tsx',
    'app/admin/events/[id]/edit/page.tsx',
  ])('%s checks the status before reading results, for both lookup modes', (file) => {
    const src = read(file)
    expect(src).toMatch(/import \{ geocodeFailureMessage \} from '@\/lib\/geocodeError'/)
    const checks = src.match(/const failure = geocodeFailureMessage\(res\.status\)\s*\n\s*if \(failure\) \{ toast\.error\(failure\); return \}\s*\n\s*const data = await res\.json\(\)/g) ?? []
    expect(checks).toHaveLength(2)
    // Every call to the route carries the city it belongs to.
    const calls = src.match(/\/app\/api\/admin\/geocode\?[^`]*`/g) ?? []
    expect(calls).toHaveLength(2)
    for (const c of calls) expect(c).toContain('${geocodeCityParam}')
  })
})

describe('79. location lookup follows the city country', () => {
  const upstreamUrls = () => fetchMock.mock.calls.map(c => String(c[0]))
  const host = () => {
    session.current = { id: 'h1', role: 'member', cityId: 'c1' }
    access.clubHost = true
  }

  it("limits Nominatim to the named city's country (?city=<slug>)", async () => {
    host()
    p.city.findFirst.mockResolvedValue({ name: 'Tbilisi', country: 'GE', lat: 41.72, lng: 44.79 })
    const res = await geocodeGET(req('http://x/app/api/admin/geocode?q=Rustaveli+Ave+1&city=tbilisi'))
    expect(await res.json()).toEqual([{ lat: '41.7', lon: '44.8' }])
    expect(p.city.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'tbilisi' } }))
    const [nominatim] = upstreamUrls()
    expect(nominatim).toContain('nominatim.openstreetmap.org')
    expect(new URL(nominatim).searchParams.get('countrycodes')).toBe('ge')
  })

  it("?cityId= (the host edit form's event city) resolves the same way", async () => {
    host()
    p.city.findFirst.mockResolvedValue({ name: 'Tbilisi', country: 'GE', lat: null, lng: null })
    await geocodeGET(req('http://x/app/api/admin/geocode?q=x&cityId=city-tbilisi'))
    expect(p.city.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'city-tbilisi' } }))
    expect(new URL(upstreamUrls()[0]).searchParams.get('countrycodes')).toBe('ge')
  })

  it("falls back to the viewer's city when the form names none", async () => {
    host()
    await geocodeGET(req('http://x/app/api/admin/geocode?q=x'))
    expect(resolveCityId).toHaveBeenCalled()
    expect(new URL(upstreamUrls()[0]).searchParams.get('countrycodes')).toBe('gr')
  })

  it('an unknown city or country searches with no country restriction at all', async () => {
    host()
    p.city.findFirst.mockResolvedValue(null)
    await geocodeGET(req('http://x/app/api/admin/geocode?q=x&city=nowhere'))
    expect(new URL(upstreamUrls()[0]).searchParams.has('countrycodes')).toBe(false)

    fetchMock.mockClear()
    p.city.findFirst.mockResolvedValue({ name: 'Legacy', country: 'Somewhere Land', lat: null, lng: null })
    await geocodeGET(req('http://x/app/api/admin/geocode?q=x&city=legacy'))
    expect(new URL(upstreamUrls()[0]).searchParams.has('countrycodes')).toBe(false)
  })

  it("the Photon fallback has no fixed bounding box and keeps only a result in the city's country", async () => {
    host()
    p.city.findFirst.mockResolvedValue({ name: 'Tbilisi', country: 'GE', lat: 41.72, lng: 44.79 })
    fetchMock.mockImplementation(async (url: string) => url.includes('nominatim')
      ? { json: async () => [] }
      : { json: async () => ({ features: [
          { geometry: { coordinates: [29.0, 41.0] }, properties: { countrycode: 'XX' } },
          { geometry: { coordinates: [44.8, 41.7] }, properties: { countrycode: 'GE' } },
        ] }) })
    const res = await geocodeGET(req('http://x/app/api/admin/geocode?q=x&city=tbilisi'))
    expect(await res.json()).toEqual([{ lat: '41.7', lon: '44.8' }])
    const photon = new URL(upstreamUrls().find(u => u.includes('photon'))!)
    expect(photon.searchParams.has('bbox')).toBe(false)
    expect(photon.searchParams.get('lat')).toBe('41.72')
    expect(photon.searchParams.get('lon')).toBe('44.79')
  })

  it('countryCodeFor derives the ISO code from the stored value, null when unknown', () => {
    expect(countryCodeFor('GE')).toBe('GE')
    expect(countryCodeFor(' ge ')).toBe('GE')
    expect(countryCodeFor('')).toBeNull()
    expect(countryCodeFor(null)).toBeNull()
    expect(countryCodeFor('QQ')).toBeNull()
    expect(countryCodeFor('Somewhere Land')).toBeNull()
  })

  it('the route source carries no hardcoded country filter or bounding box', () => {
    const src = read('app/api/admin/geocode/route.ts')
    expect(src).not.toMatch(/countrycodes=[a-z]{2}/i)
    expect(src).not.toMatch(/bbox=/)
    expect(src).not.toMatch(/['"`]tr['"`]/i)
  })
})
