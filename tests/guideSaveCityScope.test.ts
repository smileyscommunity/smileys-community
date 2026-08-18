import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  guideEntry: { findMany: vi.fn() },
  city:       { findFirst: vi.fn() },
} }))
vi.mock('@/lib/city', () => ({
  getDefaultCityId:  vi.fn(async () => 'c-istanbul'),
  getCityConfig:     vi.fn(async () => ({ slug: 'istanbul', name: 'Istanbul' })),
  // guideContent reads this now (photos are keyed by city); a mocked module
  // throws on any export it doesn't declare, and the throw was being swallowed
  // by the loader's own try/catch.
  DEFAULT_CITY_SLUG: 'istanbul',
}))

import { prisma } from '@/lib/prisma'
import { getExperienceAnyCity } from '@/lib/guideContent'

// Save / Recommend / "I've done this" validate the slug before writing. They
// used getExperience(slug), which resolves against the DEFAULT city only — so
// every one of Bodrum's twelve published pages answered 404 on those buttons.
// Verified against the running endpoint: 404 before the fix, 200 after.

const row = (over: Record<string, unknown> = {}) => ({
  slug: 'take-a-boat-into-the-bays', title: 'Take a boat into the bays', emoji: '⛵',
  collection: 'boat', moods: ['boat'], seasons: ['summer'], tagline: 't',
  cost: null, time: null, when: null, neighborhoods: [], firstTime: false,
  content: { why: 'w', take: 't', sections: [] },
  cityId: 'c-bodrum', city: { id: 'c-bodrum', slug: 'bodrum', name: 'Bodrum' },
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('getExperienceAnyCity', () => {
  it("resolves an experience that belongs to a NON-default city", async () => {
    ;(prisma.guideEntry.findMany as any).mockResolvedValue([row()])
    const found = await getExperienceAnyCity('take-a-boat-into-the-bays')
    expect(found?.citySlug).toBe('bodrum')
    expect(found?.cityName).toBe('Bodrum')
    expect(found?.experience.slug).toBe('take-a-boat-into-the-bays')
  })

  it('only ever looks at PUBLISHED experiences', async () => {
    ;(prisma.guideEntry.findMany as any).mockResolvedValue([row()])
    await getExperienceAnyCity('take-a-boat-into-the-bays')
    expect((prisma.guideEntry.findMany as any).mock.calls[0][0].where)
      .toEqual({ slug: 'take-a-boat-into-the-bays', kind: 'experience', status: 'published' })
  })

  it('gives the default city the slug when two cities share one', async () => {
    // Slugs are unique per city, so a collision is possible; the default city's
    // is the one already indexed and shared, so it wins.
    ;(prisma.guideEntry.findMany as any).mockResolvedValue([
      row(),
      row({ cityId: 'c-istanbul', city: { id: 'c-istanbul', slug: 'istanbul', name: 'Istanbul' } }),
    ])
    expect((await getExperienceAnyCity('take-a-boat-into-the-bays'))?.citySlug).toBe('istanbul')
  })

  it('returns undefined for a slug no city has', async () => {
    ;(prisma.guideEntry.findMany as any).mockResolvedValue([])
    // Falls through to the shipped JSON, which has no such slug either.
    expect(await getExperienceAnyCity('no-such-experience')).toBeUndefined()
  })
})
