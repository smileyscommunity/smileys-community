import { describe, it, expect, vi, beforeEach } from 'vitest'

// The warnings tally on the Offences queue. Its whole value is that it counts
// the SAME offences decideIssuance counts — an admin reading "1 warning" is
// reading "one more and that is a yellow". A tally with its own filter would
// drift from the rule silently and be worse than no column at all.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({
  isAdmin: (s: any) => s?.role === 'admin',
  canModerateReports: () => true,
  failClosedCityId: () => 'c1',
}))
vi.mock('@/lib/admin/maskContact', () => ({ maskRows: (_s: any, rows: any) => rows }))
vi.mock('@/lib/noShowPolicy', () => ({ reviewConflict: () => null, eventRunners: () => ({ hostId: 'h1', cohostIds: [], clubHostIds: [] }) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  standingOffence: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn(async () => 0) },
  standingCard:    { findMany: vi.fn(async () => []) },
  appSetting:      { findUnique: vi.fn(async () => null) },
} }))

import { GET } from '@/app/api/admin/standing/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { decideIssuance, YELLOW_AFTER_OFFENCES, windowStart, OffenceStatus } from '@/lib/standingPolicy'

const p = prisma as any
const req = (view: string) => ({ nextUrl: { searchParams: new URLSearchParams(`view=${view}`) } }) as any
const event = { id: 'e1', title: 'T', emoji: '☕', date: '2026-09-17', cityId: 'c1', hostId: 'h1', cohosts: [], club: null }
const row = (id: string, userId: string) => ({
  id, userId, kind: 'no_show', tier: 'scarce', counts: true, loggedReason: null, status: 'open',
  occurredAt: new Date('2026-09-17T16:00:00Z'), recordedAt: new Date('2026-09-18T21:00:00Z'),
  disputeNote: null, disputedAt: null, resolutionNote: null,
  user: { id: userId, name: userId, email: `${userId}@x`, cityId: 'c1' }, event,
})

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'a1', name: 'A', role: 'admin', cityId: 'c1' })
  p.standingOffence.groupBy.mockResolvedValue([])
  p.standingOffence.count.mockResolvedValue(0)
})

describe('the warnings tally', () => {
  it('counts only what would issue a card: counting, open, uncarded, in the window', async () => {
    p.standingOffence.findMany.mockResolvedValue([row('o1', 'u1')])
    await GET(req('offences'))
    const { where } = p.standingOffence.groupBy.mock.calls[0][0]
    expect(where.counts).toBe(true)
    expect(where.status).toBe(OffenceStatus.Open)
    expect(where.cardId).toBeNull()
    // Same window decideIssuance uses, to the day.
    const cutoff = where.occurredAt.gte as Date
    expect(Math.abs(cutoff.getTime() - windowStart(new Date()).getTime())).toBeLessThan(5_000)
  })

  it('puts each member their own tally, and zero when they have none', async () => {
    p.standingOffence.findMany.mockResolvedValue([row('o1', 'u1'), row('o2', 'u2')])
    p.standingOffence.groupBy.mockResolvedValue([{ userId: 'u1', _count: { _all: 2 } }])
    const { items } = await (await GET(req('offences'))).json()
    expect(items.map((i: any) => [i.user.id, i.warnings])).toEqual([['u1', 2], ['u2', 0]])
  })

  it('agrees with decideIssuance about where a card starts', async () => {
    const offence = (id: string) => ({
      id, counts: true, status: OffenceStatus.Open, cardId: null,
      occurredAt: new Date(), kind: 'no_show', tier: 'scarce',
    })
    const under = Array.from({ length: YELLOW_AFTER_OFFENCES - 1 }, (_, i) => offence(`a${i}`))
    const at    = Array.from({ length: YELLOW_AFTER_OFFENCES },     (_, i) => offence(`b${i}`))
    // One short is a warning and nothing more; the threshold is a card.
    expect(decideIssuance(under as never, null, new Date(), false).kind).toBe('none')
    expect(decideIssuance(at as never, null, new Date(), false).kind).toBe('yellow')
  })

  it('skips the query entirely when the queue is empty', async () => {
    p.standingOffence.findMany.mockResolvedValue([])
    await GET(req('offences'))
    expect(p.standingOffence.groupBy).not.toHaveBeenCalled()
  })
})

describe('the queue reports what it is holding back', () => {
  it('returns the true total beside a capped page', async () => {
    // The page prints "showing the first N of TOTAL" from this. Without it a
    // truncated queue just stopped at the cap and looked complete.
    ;(getSession as any).mockResolvedValue({ id: 'a1', role: 'admin', cityId: 'c1' })
    p.standingOffence.findMany.mockResolvedValue([row('o1', 'u1')])
    p.standingOffence.count.mockResolvedValue(340)
    const body = await (await GET(req('offences'))).json()
    expect(body.total).toBe(340)
    expect(body.items).toHaveLength(1)
  })

  it('counts the same rows it returns', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'a1', role: 'admin', cityId: 'c1' })
    p.standingOffence.findMany.mockResolvedValue([row('o1', 'u1')])
    await GET(req('offences'))
    const countWhere = p.standingOffence.count.mock.calls[0][0].where
    const listWhere  = p.standingOffence.findMany.mock.calls[0][0].where
    expect(countWhere).toEqual(listWhere)
  })
})
