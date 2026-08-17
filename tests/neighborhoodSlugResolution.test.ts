import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  neighborhood: { findMany: vi.fn() },
} }))
vi.mock('@/lib/city', () => ({
  getCityConfig: vi.fn(async (id: string) => ({ id, slug: citySlug(id), name: citySlug(id) })),
  DEFAULT_CITY_SLUG: 'istanbul',
}))

import { prisma } from '@/lib/prisma'
import { resolveNeighborhoodBySlug } from '@/lib/neighborhoodsDb'

// getNeighborhoodsForCity caches its registry per cityId for 60s in module
// memory, so every case below uses its OWN city ids — reusing them leaks one
// test's neighborhoods into the next, which is exactly what a first draft of
// this file did. The city id carries its slug: "istanbul#4" -> "istanbul".
function citySlug(id: string): string {
  return id.split('#')[0]
}

// /neighborhoods/<slug> carries no city, so the page used to resolve one from
// the session. A link-preview crawler never has a cookie, so it always got the
// default city — which 404'd every other city's neighborhood and put Istanbul's
// site-wide title on the share card. All 15 Bodrum pages were unreachable and
// unindexable that way.
//
// The rule pinned here: the viewer's city is a hint, not the answer. It wins
// when it has the slug; otherwise the slug is searched across public cities,
// with a deterministic tie-break because slugs are unique per city, not
// globally.

function mockCities(byCity: Record<string, { name: string; slug: string }[]>) {
  ;(prisma.neighborhood.findMany as any).mockImplementation(async ({ where }: any) => {
    // The cross-city lookup: filtered by slug, not cityId.
    if (where?.slug && !where?.cityId) {
      return Object.entries(byCity).flatMap(([cityId, rows]) =>
        rows.some(r => r.slug === where.slug)
          ? [{ cityId, city: { slug: citySlug(cityId) } }]
          : [])
    }
    // The per-city registry fetch.
    return (byCity[where.cityId] ?? []).map(r => ({
      id: `n-${r.slug}`, name: r.name, slug: r.slug,
      emoji: '📍', vibe: '', area: '', cost: 2, lat: 0, lng: 0,
    }))
  })
}

beforeEach(() => vi.clearAllMocks())

describe('resolveNeighborhoodBySlug', () => {
  it("uses the viewer's own city when it has the slug", async () => {
    mockCities({ 'istanbul#1': [{ name: 'Kadıköy', slug: 'kadikoy' }], 'bodrum#1': [] })
    const hit = await resolveNeighborhoodBySlug('kadikoy', 'istanbul#1')
    expect(hit?.cityId).toBe('istanbul#1')
    expect(hit?.view.name).toBe('Kadıköy')
  })

  it("finds another city's neighborhood when the viewer's city lacks it — the crawler case", async () => {
    mockCities({ 'istanbul#2': [], 'bodrum#2': [{ name: 'Gümüşlük', slug: 'gumusluk' }] })
    // A crawler has no cookie, so it resolves to the default city and would
    // previously have 404'd on every Bodrum neighborhood.
    const hit = await resolveNeighborhoodBySlug('gumusluk', 'istanbul#2')
    expect(hit?.cityId).toBe('bodrum#2')
    expect(hit?.view.name).toBe('Gümüşlük')
  })

  it('returns null for a slug no city has', async () => {
    mockCities({ 'istanbul#3': [], 'bodrum#3': [] })
    expect(await resolveNeighborhoodBySlug('nowhere', 'istanbul#3')).toBeNull()
  })

  it("prefers the viewer's city over another city holding the same slug", async () => {
    mockCities({
      'istanbul#4': [{ name: 'Merkez', slug: 'merkez' }],
      'bodrum#4':   [{ name: 'Merkez', slug: 'merkez' }],
    })
    const hit = await resolveNeighborhoodBySlug('merkez', 'bodrum#4')
    expect(hit?.cityId).toBe('bodrum#4')
  })

  it('breaks a tie toward the default city, not DB order', async () => {
    mockCities({
      'izmir#5':    [{ name: 'Merkez', slug: 'merkez' }],
      'istanbul#5': [{ name: 'Merkez', slug: 'merkez' }],
      'bodrum#5':   [],
    })
    // Viewer's city has no such slug, so the tie-break decides: istanbul wins
    // even though izmir came back first.
    const hit = await resolveNeighborhoodBySlug('merkez', 'bodrum#5')
    expect(hit?.cityId).toBe('istanbul#5')
  })

  it('breaks a remaining tie alphabetically so the result is stable', async () => {
    mockCities({
      'izmir#6':    [{ name: 'Merkez', slug: 'merkez' }],
      'bodrum#6':   [{ name: 'Merkez', slug: 'merkez' }],
      'istanbul#6': [],
    })
    const hit = await resolveNeighborhoodBySlug('merkez', 'istanbul#6')
    expect(hit?.cityId).toBe('bodrum#6')   // bodrum < izmir
  })
})
