import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/city', () => ({
  resolveCityId: vi.fn(),
  describeCity:  vi.fn(),
  getCityConfig: vi.fn(),
}))
vi.mock('@/lib/cityMembership', () => ({ resolvePostingCityId: vi.fn() }))

import { GET } from '@/app/api/city/current/route'
import { getSession } from '@/lib/session'
import { resolveCityId, describeCity, getCityConfig } from '@/lib/city'
import { resolvePostingCityId } from '@/lib/cityMembership'

// A write follows MEMBERSHIP, not the view-city cookie: resolvePostingCityId
// files a listing to your home city unless you actually belong to the city
// you're browsing, because alert fan-out matches subscribers on their home
// city and a listing filed into a city you merely looked at reaches nobody.
//
// Correct, and it used to be invisible — the compose form named no city at
// all. Someone browsing Bodrum's marketplace had no way to know their listing
// was going to Istanbul. This endpoint is what lets the form say so, which
// means "which city would MY post land in" has to be answered from the posting
// rule, never from the city on screen.

const MEMBER = { id: 'u1', cityId: 'c-ist' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(MEMBER)
  ;(resolveCityId as any).mockResolvedValue('c-bod')
  ;(describeCity as any).mockResolvedValue({
    name: 'Bodrum', slug: 'bodrum', isDefault: false, viewing: true, homeName: 'Istanbul',
  })
  ;(getCityConfig as any).mockResolvedValue({ name: 'Istanbul', slug: 'istanbul' })
})

const body = async () => (await GET()).json()

describe('GET /api/city/current — posting city', () => {
  it('flags the mismatch when the viewer is browsing a city they cannot post to', async () => {
    ;(resolvePostingCityId as any).mockResolvedValue('c-ist')   // home wins
    const d = await body()
    expect(d.name).toBe('Bodrum')                // what they're looking at
    expect(d.posting).toEqual({ name: 'Istanbul', slug: 'istanbul', differs: true })
  })

  it('reports no mismatch when the viewed city IS the posting city', async () => {
    ;(resolvePostingCityId as any).mockResolvedValue('c-bod')   // they joined Bodrum
    const d = await body()
    expect(d.posting).toEqual({ name: 'Bodrum', slug: 'bodrum', differs: false })
    // No second lookup needed — the viewed city's name is already in hand.
    expect(getCityConfig).not.toHaveBeenCalled()
  })

  it('never claims a posting city for a guest — they have nothing to post with', async () => {
    ;(getSession as any).mockResolvedValue(null)
    const d = await body()
    expect(d.posting).toBeUndefined()
    expect(resolvePostingCityId).not.toHaveBeenCalled()
  })

  it('still returns the existing shape, so /clubs and /directory keep working', async () => {
    ;(resolvePostingCityId as any).mockResolvedValue('c-bod')
    const d = await body()
    expect(d).toMatchObject({ name: 'Bodrum', slug: 'bodrum', isDefault: false, viewing: true, homeName: 'Istanbul' })
  })

  it('asks the posting rule, not the view cookie, which city a post lands in', async () => {
    ;(resolvePostingCityId as any).mockResolvedValue('c-ist')
    await body()
    expect(resolvePostingCityId).toHaveBeenCalledWith(MEMBER)
  })
})
