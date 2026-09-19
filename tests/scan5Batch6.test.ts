import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 23–26.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => ({
  event:      { findMany: vi.fn() },
  noShowCard: { findUnique: vi.fn() },
}))
const h = vi.hoisted(() => ({
  canActInCity: vi.fn((s: { cityId?: string }, cityId: string | null) => cityId === s.cityId),
  resolveCard:  vi.fn(async () => 'ok'),
  session:      { current: null as Record<string, unknown> | null },
}))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/access', () => ({
  canActInCity: h.canActInCity,
  isAdmin: (s: { role: string }) => s.role === 'admin',
  canModerateReports: (s: { role: string; cityId?: string }, cityId?: string) => s.role === 'moderator' && (cityId === undefined || cityId === s.cityId),
}))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => h.session.current) }))

import { checkSeriesId, seriesScopeFor } from '@/lib/seriesOwnership'

beforeEach(() => { vi.clearAllMocks() })

const host = { id: 'h1', role: 'member', cityId: 'ist' } as never
const mod  = { id: 'm1', role: 'moderator', cityId: 'ist' } as never
const admin = { id: 'a1', role: 'admin', cityId: 'ist' } as never

describe('23. the reviews list carries reviewer ids', () => {
  it('so the page can find your own review after a reload', () => {
    expect(read('app/api/events/[id]/reviews/route.ts')).toContain('user: { select: { id: true, name: true, color: true } },')
  })
})

describe('24. editing a cup fixture re-reads the fixture first', () => {
  it('Edit goes through startEditing, which reseeds every field', () => {
    const src = read('components/admin/CupFixturesPanel.tsx')
    expect(src).toContain('onClick={startEditing}')
    expect(src).not.toContain('onClick={() => setEditing(true)}')
    const fn = src.slice(src.indexOf('function startEditing()'), src.indexOf('async function applyTeams()'))
    for (const s of ["setHome(fixture.homeTeam ?? '')", "setWinner(fixture.winnerTeam ?? '')", 'setHomeScore(fixture.homeScore != null', 'setAwayScore(fixture.awayScore != null', 'setEditing(true)']) {
      expect(fn).toContain(s)
    }
  })
})

describe('25. a series belongs to whoever owns its events', () => {
  it('a new series id is free to take', async () => {
    p.event.findMany.mockResolvedValue([])
    expect(await checkSeriesId('new-uuid', host, 'e1')).toEqual({ ok: true })
    expect(p.event.findMany.mock.calls[0][0].where).toEqual({ seriesId: 'new-uuid', id: { not: 'e1' } })
  })
  it('a host may join a series of their own events, never someone else\'s', async () => {
    p.event.findMany.mockResolvedValue([{ hostId: 'h1', cityId: 'ist' }])
    expect((await checkSeriesId('s', host)).ok).toBe(true)
    p.event.findMany.mockResolvedValue([{ hostId: 'h1', cityId: 'ist' }, { hostId: 'victim', cityId: 'izm' }])
    expect(await checkSeriesId('s', host)).toEqual({ ok: false, error: 'That series belongs to someone else' })
  })
  it('a moderator may join a series inside their city only', async () => {
    p.event.findMany.mockResolvedValue([{ hostId: 'x', cityId: 'ist' }])
    expect((await checkSeriesId('s', mod)).ok).toBe(true)
    p.event.findMany.mockResolvedValue([{ hostId: 'x', cityId: 'izm' }])
    expect((await checkSeriesId('s', mod)).ok).toBe(false)
  })
  it('an admin needs no lookup; clearing is always allowed; junk is refused', async () => {
    expect((await checkSeriesId('s', admin)).ok).toBe(true)
    expect((await checkSeriesId(null, host)).ok).toBe(true)
    expect(p.event.findMany).not.toHaveBeenCalled()
    expect((await checkSeriesId({ evil: 1 }, host)).ok).toBe(false)
    expect((await checkSeriesId('x'.repeat(65), host)).ok).toBe(false)
  })
  it('apply-to-series is scoped to what the caller could edit', () => {
    expect(seriesScopeFor(admin, 'ist')).toEqual({})
    expect(seriesScopeFor(mod, 'ist')).toEqual({ cityId: 'ist' })
    expect(seriesScopeFor(host, 'ist')).toEqual({ hostId: 'h1' })
  })
  it('the edit and create routes both enforce it', () => {
    const put = read('app/api/admin/events/[id]/route.ts')
    expect(put).toContain('const series = await checkSeriesId(rest.seriesId, session, id)')
    expect(put).toContain('date: { gte: today }, ...seriesScopeFor(session, before.cityId) },')
    expect(read('app/api/admin/events/route.ts')).toContain('const series = await checkSeriesId(seriesId, session)')
  })
})

// 26's "nobody resolves their own card" moved to standingReviewConflict.test
// with v1's cards route — standing's offence decision enforces it now.
