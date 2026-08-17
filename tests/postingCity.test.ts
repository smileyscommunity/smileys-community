import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: vi.fn() },
} }))
vi.mock('@/lib/city', () => ({ resolveCityId: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { resolveCityId } from '@/lib/city'
import { resolvePostingCityId } from '@/lib/cityMembership'

const ISTANBUL = { id: 'c-ist', slug: 'istanbul', name: 'Istanbul', status: 'live' }
const IZMIR    = { id: 'c-izm', slug: 'izmir',    name: 'Izmir',    status: 'live' }

// Home is Istanbul; `joined` is the extra 'member' relationships.
function memberOf(joined: typeof IZMIR[] = []) {
  ;(prisma.user.findUnique as any).mockResolvedValue({
    city: ISTANBUL,
    cityRelationships: joined.map(c => ({ city: c })),
  })
}

beforeEach(() => vi.clearAllMocks())

// The bug this encodes: alert fan-out matches subscribers on their HOME city,
// so a listing filed into a city the poster merely *browsed* reaches nobody —
// not that city (no subscribers there yet) and not the poster's own. The
// view-city cookie lasts a year, so one click into another city's shopfront
// used to capture every subsequent write.

describe('resolvePostingCityId', () => {
  it('uses the viewed city when it IS the home city', async () => {
    ;(resolveCityId as any).mockResolvedValue('c-ist')
    memberOf()
    expect(await resolvePostingCityId({ id: 'u1', cityId: 'c-ist' })).toBe('c-ist')
    // No membership lookup needed when there's nothing to disambiguate.
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('honours a viewed city the member has actually joined', async () => {
    ;(resolveCityId as any).mockResolvedValue('c-izm')
    memberOf([IZMIR])
    expect(await resolvePostingCityId({ id: 'u1', cityId: 'c-ist' })).toBe('c-izm')
  })

  it('falls back home when the member only browsed that city', async () => {
    ;(resolveCityId as any).mockResolvedValue('c-izm')
    memberOf()   // no Izmir relationship — the cookie is all they have
    expect(await resolvePostingCityId({ id: 'u1', cityId: 'c-ist' })).toBe('c-ist')
  })

  it('falls back to the resolved city when the session has no home city', async () => {
    ;(resolveCityId as any).mockResolvedValue('c-ist')
    memberOf()
    expect(await resolvePostingCityId({ id: 'u1' })).toBe('c-ist')
  })
})
