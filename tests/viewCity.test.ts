import { describe, it, expect, vi, beforeEach } from 'vitest'

// The city selector's contract. The load-bearing property is the LAST test:
// switching what you're looking at must never change what you're allowed to do.

const cookieStore = { value: undefined as string | undefined }

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'smileys_city' && cookieStore.value
      ? { value: cookieStore.value }
      : undefined),
  }),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {
  city: { findFirst: vi.fn(), findUnique: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { resolveCityId, getViewCityId } from '@/lib/city'
import { canActInCity } from '@/lib/access'

const HOME = 'c-istanbul'
const AWAY = 'c-athens'

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.value = undefined
  // Only live cities resolve — findFirst carries a status:'live' filter.
  ;(prisma.city.findFirst as any).mockImplementation(async ({ where }: any) =>
    where.slug === 'athens' ? { id: AWAY } : null)
})

describe('viewing city', () => {
  it('falls back to the member\'s own city when no cookie is set', async () => {
    expect(await resolveCityId({ cityId: HOME })).toBe(HOME)
  })

  it('scopes feeds to the viewed city when one is selected', async () => {
    cookieStore.value = 'athens'
    expect(await resolveCityId({ cityId: HOME })).toBe(AWAY)
  })

  it('ignores a cookie naming a city that is not live', async () => {
    // A stale cookie for a paused or pre-launch city must fall back rather than
    // empty every feed.
    cookieStore.value = 'izmir'
    expect(await resolveCityId({ cityId: HOME })).toBe(HOME)
    expect(await getViewCityId()).toBeNull()
  })

  it('does not grant a moderator any authority in the city they are viewing', async () => {
    cookieStore.value = 'athens'
    const mod = { id: 'u1', name: 'Mod', email: 'm@x.co', role: 'moderator', color: '#fff', cityId: HOME }
    // Feeds follow the view…
    expect(await resolveCityId(mod)).toBe(AWAY)
    // …permissions do not. This is the whole reason the override is a cookie
    // read by resolveCityId rather than a change to the session.
    expect(canActInCity(mod as any, AWAY)).toBe(false)
    expect(canActInCity(mod as any, HOME)).toBe(true)
  })
})
