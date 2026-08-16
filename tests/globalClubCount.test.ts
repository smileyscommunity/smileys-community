import { describe, it, expect, vi, beforeEach } from 'vitest'

// A global club (cityId null) is listed in every city. Its network-wide member
// count therefore says nothing about the city you're standing in — "225
// members" on Bodrum's club list promises 225 people nearby when the real
// answer is none. getClubs reports a city-scoped count for global clubs and
// keeps the network figure separately.
//
// This is pinned because the failure is silent and flattering: the number looks
// plausible, nobody reports it, and it only misleads members in the smallest
// cities — the ones least able to absorb a bad first impression.

vi.mock('@/lib/prisma', () => ({ prisma: { club: { findMany: vi.fn() } } }))
vi.mock('@/lib/cityTime', () => ({ todayInTz: () => '2026-08-16', DEFAULT_TZ: 'Europe/Istanbul' }))

import { prisma } from '@/lib/prisma'
import { getClubs } from '@/lib/db'

const base = { id: 'c1', slug: 'x', name: 'X', events: [] }

beforeEach(() => vi.clearAllMocks())

describe('club member counts', () => {
  it('reports the city-scoped count for a global club, not the network total', async () => {
    ;(prisma.club.findMany as any).mockResolvedValue([{
      ...base,
      cityId: null,                                   // global
      _count: { memberships: 225 },                   // across Smileys
      memberships: [],                                // none in this city
    }])
    const [club] = await getClubs('c-bodrum')
    expect(club.memberCount).toBe(0)
    expect(club.globalMemberCount).toBe(225)
    expect(club.isGlobal).toBe(true)
  })

  it('leaves a city-scoped club unchanged — both counts agree', async () => {
    ;(prisma.club.findMany as any).mockResolvedValue([{
      ...base,
      cityId: 'c-istanbul',
      _count: { memberships: 42 },
      memberships: [{ id: 'm1' }, { id: 'm2' }],
    }])
    const [club] = await getClubs('c-istanbul')
    // The scoped list is irrelevant here: a local club's members are all local,
    // so the aggregate is the honest number and stays authoritative.
    expect(club.memberCount).toBe(42)
    expect(club.globalMemberCount).toBe(42)
    expect(club.isGlobal).toBe(false)
  })

  it('counts a global club properly in the city its members are in', async () => {
    ;(prisma.club.findMany as any).mockResolvedValue([{
      ...base,
      cityId: null,
      _count: { memberships: 225 },
      memberships: Array.from({ length: 225 }, (_, i) => ({ id: `m${i}` })),
    }])
    const [club] = await getClubs('c-istanbul')
    expect(club.memberCount).toBe(225)
  })
})
