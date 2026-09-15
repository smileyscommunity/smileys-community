import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// The host event EDIT page followed the browsed city for everything city-shaped
// (neighborhood list, geocode hint, price labels) — the same bug scan-6 item 17
// fixed on the new-event page. An event's city is fixed where it was filed;
// moving it to another club does not change it. The page now asks
// /api/city/current?cityId=<event.cityId> for that city and uses it throughout.

const h = vi.hoisted(() => ({
  city: { findUnique: vi.fn() },
}))

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/city', () => ({
  resolveCityId: vi.fn(),
  describeCity:  vi.fn(),
  getCityConfig: vi.fn(),
}))
vi.mock('@/lib/cityMembership', () => ({ resolvePostingCityId: vi.fn() }))
vi.mock('@/lib/cities', () => ({ getPublicCity: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { city: h.city } }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/city/current/route'
import { getSession } from '@/lib/session'
import { resolveCityId, describeCity, getCityConfig } from '@/lib/city'
import { resolvePostingCityId } from '@/lib/cityMembership'

const read = (p: string) => readFileSync(p, 'utf-8')
const get = (qs = '') => GET(new NextRequest(`http://localhost/app/api/city/current${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', cityId: 'c-ist' })
  ;(resolveCityId as any).mockResolvedValue('c-ist')
  ;(resolvePostingCityId as any).mockResolvedValue('c-ist')
  // Asking about another city makes the route also name the posting city.
  ;(getCityConfig as any).mockResolvedValue({ name: 'Home', slug: 'home' })
  ;(describeCity as any).mockImplementation(async (id: string) => (
    id === 'c-tbs'
      ? { name: 'Tbilisi', slug: 'tbilisi', country: 'GE', currency: 'GEL', timezone: 'Asia/Tbilisi' }
      : { name: 'Home', slug: 'home', country: 'TR', currency: 'TRY', timezone: 'Europe/Istanbul' }
  ))
})

describe('GET /api/city/current?cityId=', () => {
  it('describes exactly that city, ignoring the view-city cookie', async () => {
    h.city.findUnique.mockResolvedValueOnce({ id: 'c-tbs' })
    const res = await get('?cityId=c-tbs')
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d).toMatchObject({ slug: 'tbilisi', country: 'GE', currency: 'GEL' })
    expect(h.city.findUnique).toHaveBeenCalledWith({ where: { id: 'c-tbs' }, select: { id: true } })
    expect(describeCity).toHaveBeenCalledWith('c-tbs', expect.anything())
    expect(resolveCityId).not.toHaveBeenCalled()
  })

  it('an unknown id is a 404, never another city', async () => {
    h.city.findUnique.mockResolvedValueOnce(null)
    const res = await get('?cityId=nope')
    expect(res.status).toBe(404)
    expect(describeCity).not.toHaveBeenCalled()
  })

  it('without ?cityId the cookie-resolved behaviour is unchanged', async () => {
    const d = await (await get()).json()
    expect(d.slug).toBe('home')
    expect(h.city.findUnique).not.toHaveBeenCalled()
    expect(resolveCityId).toHaveBeenCalled()
  })
})

describe('host event edit page follows the event\'s city', () => {
  const src = read('app/host/events/[id]/edit/page.tsx')

  it('loads the event city by id and derives formCity from it', () => {
    expect(src).toMatch(/fetch\(`\/app\/api\/city\/current\?cityId=\$\{encodeURIComponent\(event\.cityId\)\}`/)
    expect(src).toMatch(/const formCity = eventCity \?\? \(!loading && \(!eventCityId \|\| eventCityFailed\) \? city : null\)/)
  })

  it('neighborhoods come from the event city, never the bare browsed-city call', () => {
    expect(src).toMatch(/useCityNeighborhoods\(formCity \? formCity\.slug : null\)/)
    expect(src).not.toMatch(/useCityNeighborhoods\(\)/)
  })

  it('the geocode hint, city param and price labels use the event city', () => {
    expect(src).toMatch(/const cityHint = formCity \? \[formCity\.name, countryName\(formCity\.country\)\]/)
    expect(src).toMatch(/eventCityId \? `&cityId=\$\{encodeURIComponent\(eventCityId\)\}`/)
    expect(src).toMatch(/formCity\?\.slug \? `&city=\$\{encodeURIComponent\(formCity\.slug\)\}`/)
    expect(src.match(/currencySymbol\(formCity\?\.currency\)/g) ?? []).toHaveLength(2)
    expect(src).not.toMatch(/city \? \[city\.name, countryName\(city\.country\)\]/)
  })
})
