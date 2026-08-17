import { describe, it, expect, vi, beforeEach } from 'vitest'

// The rule every write path that sets User.neighborhood must apply. Pinned
// because the failure it prevents is silent and flattering: a member with a
// value that isn't in their city's registry keeps a filled-in profile while
// being excluded from their own neighborhood page, "members near you" and
// neighborhood event matching. Nobody reports it. 33 prod rows had to be
// repaired by hand before this existed (scripts/fix-member-neighborhoods.ts).

vi.mock('@/lib/prisma', () => ({ prisma: { neighborhood: { findMany: vi.fn() } } }))
vi.mock('@/lib/city', () => ({
  getCityConfig:     vi.fn(async () => ({ slug: 'bodrum' })),
  DEFAULT_CITY_SLUG: 'istanbul',
}))

import { prisma } from '@/lib/prisma'
import { normalizeNeighborhoodInput } from '@/lib/neighborhoodsDb'

const BODRUM = [{ name: 'Bodrum Merkez' }, { name: 'Gümbet' }, { name: 'Yalıkavak' }]

beforeEach(() => {
  vi.clearAllMocks()
  // getNeighborhoodsForCity memoizes per cityId for 5 minutes, so each test
  // uses a fresh city id rather than fighting the cache.
  ;(prisma.neighborhood.findMany as any).mockResolvedValue(BODRUM)
})

let n = 0
const freshCity = () => `c-bodrum-${n++}`

describe('normalizeNeighborhoodInput', () => {
  it('accepts a real neighborhood of the city', async () => {
    expect(await normalizeNeighborhoodInput(freshCity(), 'Gümbet')).toEqual({ ok: true, value: 'Gümbet' })
  })

  it('trims before matching', async () => {
    expect(await normalizeNeighborhoodInput(freshCity(), '  Gümbet  ')).toEqual({ ok: true, value: 'Gümbet' })
  })

  it('treats blank as "clear it", never as a value', async () => {
    // The 21-row bug: '' stored as if it were a neighborhood.
    for (const blank of ['', '   ', null, undefined]) {
      expect(await normalizeNeighborhoodInput(freshCity(), blank)).toEqual({ ok: true, value: null })
    }
  })

  it('rejects another city\'s neighborhood', async () => {
    // A Bodrum member holding an Istanbul district — how Serhan Baykan ended
    // up with "Beyoğlu" and two Antalya members with "Kadıköy" / "Moda".
    const res = await normalizeNeighborhoodInput(freshCity(), 'Kadıköy')
    expect(res.ok).toBe(false)
  })

  it('rejects a diacritic-stripped near-miss rather than storing it', async () => {
    // 'Gumbet' looks right to a human and matches nothing. The repair script
    // folds these; the write path's job is to never accept one in the first
    // place, since the picker offers the real spelling.
    expect((await normalizeNeighborhoodInput(freshCity(), 'Gumbet')).ok).toBe(false)
    expect((await normalizeNeighborhoodInput(freshCity(), 'gümbet')).ok).toBe(false)
  })

  it('rejects non-text and over-long input', async () => {
    expect((await normalizeNeighborhoodInput(freshCity(), 42)).ok).toBe(false)
    expect((await normalizeNeighborhoodInput(freshCity(), { name: 'Gümbet' })).ok).toBe(false)
    expect((await normalizeNeighborhoodInput(freshCity(), 'x'.repeat(201))).ok).toBe(false)
  })

  it('accepts nothing at all for a city with no neighborhoods seeded', async () => {
    // Antalya's state: nothing valid exists, so every value must be refused —
    // and clearing must still work, which is the only honest option there.
    ;(prisma.neighborhood.findMany as any).mockResolvedValue([])
    const city = freshCity()
    expect((await normalizeNeighborhoodInput(city, 'Kadıköy')).ok).toBe(false)
    expect(await normalizeNeighborhoodInput(city, '')).toEqual({ ok: true, value: null })
  })

  it('only ever queries that city\'s ACTIVE neighborhoods', async () => {
    const city = freshCity()
    await normalizeNeighborhoodInput(city, 'Gümbet')
    expect((prisma.neighborhood.findMany as any).mock.calls[0][0].where).toEqual({ cityId: city, active: true })
  })
})
