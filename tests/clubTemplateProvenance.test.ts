import { describe, it, expect, vi } from 'vitest'
import { seedCityClubs } from '@/lib/seedCityClubs'
import { CLUB_TEMPLATES } from '@/lib/clubTemplates'

// Every seeded club must record which template stamped it. Without the link,
// "update every club seeded from 'foodies'" or "which cities customised the
// lineup?" becomes slug archaeology — reconstructable at 2 cities, not at 10.
// NULL stays meaningful: hand-made or pre-catalog.

function mockPrisma() {
  const created: any[] = []
  return {
    created,
    prisma: {
      city: { findUnique: vi.fn(async () => ({ id: 'c1', name: 'Izmir' })) },
      club: {
        findUnique: vi.fn(async () => null),
        create:     vi.fn(async ({ data }: any) => { created.push(data); return data }),
      },
    } as any,
  }
}

describe('club template provenance', () => {
  it('stamps every seeded club with its template key', async () => {
    const { prisma, created } = mockPrisma()
    await seedCityClubs(prisma, 'izmir')
    expect(created.length).toBe(CLUB_TEMPLATES.length)
    const unstamped = created.filter(c => !c.templateKey)
    expect(unstamped.map(c => c.slug)).toEqual([])
    // The stamp is the template's own key, not something derived per city.
    expect(new Set(created.map(c => c.templateKey))).toEqual(new Set(CLUB_TEMPLATES.map(t => t.key)))
  })

  it("opens with Bodrum's shape: 3 active core clubs, the rest dormant", async () => {
    const { prisma, created } = mockPrisma()
    await seedCityClubs(prisma, 'izmir')
    const active = created.filter(c => c.isActive).map(c => c.templateKey).sort()
    // The lowest-commitment ways to meet people open the city; everything
    // else waits for a host. Eleven empty special-interest clubs read as a
    // dead community; three warm ones read as a beginning.
    expect(active).toEqual(['coffee-social', 'newcomers', 'social'])
    expect(created.filter(c => !c.isActive).length).toBe(CLUB_TEMPLATES.length - 3)
  })
})
