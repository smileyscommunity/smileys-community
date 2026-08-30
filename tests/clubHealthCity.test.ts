import { describe, it, expect, vi, beforeEach } from 'vitest'

// Global clubs (Club.cityId null — the Culture and Language lineups) are
// listed in every city's grid, so every per-club signal has to be scoped to
// the city being viewed or it describes a community the viewer can't reach.
// The member counts were scoped; health was not, so Istanbul's events and
// board posts ranked the Language clubs "Active" on Bodrum's grid, where
// nothing has ever happened.
//
// Pinned because the failure flatters: a busy-looking grid in a city with
// three clubs reads as success, so nobody reports it.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    club:      { findMany: vi.fn() },
    event:     { groupBy: vi.fn() },
    boardPost: { groupBy: vi.fn() },
    hangout:   { groupBy: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { classifyClubs } from '@/lib/clubHealth'

const NOW = new Date('2026-08-17T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.club.findMany as any).mockResolvedValue([
    { id: 'club1', isActive: true, createdAt: new Date('2026-01-01T00:00:00Z') },
  ])
  ;(prisma.event.groupBy     as any).mockResolvedValue([])
  ;(prisma.boardPost.groupBy as any).mockResolvedValue([])
  ;(prisma.hangout.groupBy   as any).mockResolvedValue([])
})

// Each activity query's where clause, in call order.
const eventWheres = () => (prisma.event.groupBy as any).mock.calls.map((c: any[]) => c[0].where)
const oneWhere    = (m: any) => m.mock.calls[0][0].where

describe('classifyClubs city scoping', () => {
  it('scopes every activity signal to the city passed', async () => {
    await classifyClubs(['club1'], 'c-bodrum', NOW)
    // Two event queries (upcoming + last 60 days), then posts and hangouts.
    for (const where of eventWheres()) expect(where.cityId).toBe('c-bodrum')
    expect(oneWhere(prisma.boardPost.groupBy).cityId).toBe('c-bodrum')
    expect(oneWhere(prisma.hangout.groupBy).cityId).toBe('c-bodrum')
  })

  it('keeps the other filters intact alongside the city', async () => {
    await classifyClubs(['club1'], 'c-bodrum', NOW)
    const [upcoming] = eventWheres()
    expect(upcoming).toEqual(expect.objectContaining({
      clubId: { in: ['club1'] }, status: 'published', cityId: 'c-bodrum',
    }))
    expect(oneWhere(prisma.boardPost.groupBy)).toEqual(
      expect.objectContaining({ status: 'active', cityId: 'c-bodrum' }),
    )
  })

  // A global club's related-clubs list isn't city-scoped either, so its
  // health has to describe the same set that's being ranked.
  it('stays network-wide when no city is given', async () => {
    await classifyClubs(['club1'], null, NOW)
    for (const where of eventWheres()) expect('cityId' in where).toBe(false)
    expect('cityId' in oneWhere(prisma.hangout.groupBy)).toBe(false)
  })

  it('treats an omitted city the same as null', async () => {
    await classifyClubs(['club1'])
    for (const where of eventWheres()) expect('cityId' in where).toBe(false)
  })

  it('reads activity in the viewed city as active', async () => {
    ;(prisma.event.groupBy as any).mockResolvedValue([{ clubId: 'club1', _count: { _all: 2 } }])
    const health = await classifyClubs(['club1'], 'c-bodrum', NOW)
    expect(health.get('club1')).toBe('active')
  })

  // The whole point: the same club, whose only activity is elsewhere, must
  // not be advertised as active here. The city filter runs in the DB, so an
  // empty result is what "no local activity" looks like.
  it('reads a club with no activity in the viewed city as quiet', async () => {
    const health = await classifyClubs(['club1'], 'c-bodrum', NOW)
    expect(health.get('club1')).toBe('quiet')
  })

  it('makes no queries at all for an empty club list', async () => {
    const health = await classifyClubs([], 'c-bodrum', NOW)
    expect(health.size).toBe(0)
    expect(prisma.event.groupBy).not.toHaveBeenCalled()
    expect(prisma.club.findMany).not.toHaveBeenCalled()
  })
})
