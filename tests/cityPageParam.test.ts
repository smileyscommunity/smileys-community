import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cities',  () => ({ getPublicCity: vi.fn() }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => SESSION) }))
vi.mock('@/lib/city',    () => ({
  resolveCityId: vi.fn(async () => SESSION_CITY_ID),
  getCityConfig: vi.fn(async (id: string) => ({ id, slug: SLUG[id], name: SLUG[id] })),
}))

import { getPublicCity } from '@/lib/cities'
import { resolveCityForPage } from '@/lib/cityPageParam'

const SLUG: Record<string, string> = { 'c-ist': 'istanbul', 'c-bod': 'bodrum' }
const SESSION = { id: 'u1' }
const SESSION_CITY_ID = 'c-ist'

// /neighborhoods has no city in its URL, so it resolved one from the session.
// A link-preview crawler has no cookie, so every share of a non-default city's
// page previewed as the default city's — whatever the sharer had on screen.
// ?city= is what lets such a URL say which city it means.
//
// `pinned` is load-bearing beyond picking a city: the page redirects the bare
// URL to the explicit one so the address bar is itself shareable, and `pinned`
// is what stops that redirect looping.

beforeEach(() => {
  vi.clearAllMocks()
  ;(getPublicCity as any).mockImplementation(async (slug: string) =>
    slug === 'bodrum' ? { id: 'c-bod', slug: 'bodrum' } : null)
})

const sp = (city?: string) => Promise.resolve(city === undefined ? {} : { city })

describe('resolveCityForPage', () => {
  it('uses ?city= when it names a public city, and marks it pinned', async () => {
    const r = await resolveCityForPage(sp('bodrum'))
    expect(r.cityId).toBe('c-bod')
    expect(r.city.name).toBe('bodrum')
    expect(r.pinned).toBe(true)
  })

  it('falls back to the session city when there is no ?city=', async () => {
    const r = await resolveCityForPage(sp())
    expect(r.cityId).toBe('c-ist')
    // Not pinned — this is the case the page redirects, so the shared URL
    // stops being ambiguous.
    expect(r.pinned).toBe(false)
  })

  it('falls back rather than 404s on an unknown or paused slug', async () => {
    const r = await resolveCityForPage(sp('atlantis'))
    expect(r.cityId).toBe('c-ist')
    expect(r.pinned).toBe(false)
  })

  it('ignores a blank or whitespace-only param', async () => {
    expect((await resolveCityForPage(sp(''))).pinned).toBe(false)
    expect((await resolveCityForPage(sp('   '))).pinned).toBe(false)
    expect(getPublicCity).not.toHaveBeenCalled()
  })

  it('trims a padded slug rather than failing the lookup', async () => {
    const r = await resolveCityForPage(sp('  bodrum  '))
    expect(r.cityId).toBe('c-bod')
    expect(getPublicCity).toHaveBeenCalledWith('bodrum')
  })

  it('handles a page called with no searchParams at all', async () => {
    const r = await resolveCityForPage(undefined)
    expect(r.cityId).toBe('c-ist')
    expect(r.pinned).toBe(false)
  })
})
