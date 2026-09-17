import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('@/lib/notify', () => ({ createNotification: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/audit',  () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:     vi.fn(),
  $queryRaw:        vi.fn(),
  appSetting:       { findUnique: vi.fn(), upsert: vi.fn() },
  standingCard:     { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  standingOffence:  { findMany: vi.fn(), findUnique: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  standingRecovery: { createMany: vi.fn(), findMany: vi.fn() },
  eventAttendee:    { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  event:            { findMany: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import {
  standingEnforcement, setStandingEnforced, standingLevelsFor, autoResolveAttendance, recordOffences,
  evaluateMember, overturnOffence, disputeOffence, type SweepEvent,
} from '@/lib/standing'

// The standing sweep and interventions against a mocked database: what the
// switch does, which rows become offences, how cards are issued, escalated,
// cleared, sent for review and lapse, and what overturning takes down.

const p   = prisma as any
const H   = 60 * 60 * 1000
const D   = 24 * H
const NOW = new Date('2026-10-20T12:00:00Z')
const OFF = { enforced: false, since: null }
const ON  = { enforced: true, since: new Date('2026-10-01T00:00:00Z') }
// evaluateMember reads the switch itself, under the member's lock.
const switchedOn = () => p.appSetting.findUnique.mockResolvedValue({ value: 'true', updatedAt: ON.since })

beforeEach(() => {
  vi.resetAllMocks()
  p.$transaction.mockImplementation(async (fn: any) => fn(p))
  p.$queryRaw.mockResolvedValue([])
  p.appSetting.findUnique.mockResolvedValue(null)
  p.standingOffence.findMany.mockResolvedValue([])
  p.standingOffence.createMany.mockResolvedValue({ count: 0 })
  p.standingOffence.updateMany.mockResolvedValue({ count: 1 })
  p.standingCard.findMany.mockResolvedValue([])
  p.standingCard.updateMany.mockResolvedValue({ count: 0 })
  p.standingRecovery.findMany.mockResolvedValue([])
  p.standingRecovery.createMany.mockResolvedValue({ count: 0 })
  p.eventAttendee.findMany.mockResolvedValue([])
  p.eventAttendee.findFirst.mockResolvedValue({ joinedAt: NOW })
  p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
  let n = 0
  p.standingCard.create.mockImplementation(async ({ data }: any) => ({ id: `card${++n}`, status: 'active', issuedAt: NOW, ...data }))
})

describe('the member lock', () => {
  // The mocks above accept any raw query. A real database doesn't: selecting
  // pg_advisory_xact_lock bare returns void, which the Prisma pg adapter can't
  // deserialize, and every evaluation threw (found against a scratch database).
  it('selects a column around pg_advisory_xact_lock, never the void result itself', () => {
    const src = readFileSync('lib/standing.ts', 'utf8')
    expect(src).toContain('SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(')
    expect(src).not.toMatch(/\$queryRaw`SELECT pg_advisory_xact_lock/)
  })
})

describe('the switch', () => {
  it('reads as off when the setting is missing or unreadable', async () => {
    expect(await standingEnforcement()).toEqual({ enforced: false, since: null })
    p.appSetting.findUnique.mockRejectedValueOnce(new Error('db down'))
    expect(await standingEnforcement()).toEqual({ enforced: false, since: null })
    p.appSetting.findUnique.mockResolvedValueOnce({ value: 'true', updatedAt: NOW })
    expect(await standingEnforcement()).toEqual({ enforced: true, since: NOW })
  })

  it('switching on retires live shadow cards, and is audited', async () => {
    p.appSetting.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ value: 'true', updatedAt: NOW })
    p.standingCard.updateMany.mockResolvedValueOnce({ count: 3 })
    const r = await setStandingEnforced(true, { id: 'a1', name: 'Admin' }, NOW)
    expect(r.enforced).toBe(true)
    expect(p.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: 'true' } }))
    expect(p.standingCard.updateMany).toHaveBeenCalledWith({
      where: { shadow: true, status: { in: ['active', 'review'] } },
      data:  expect.objectContaining({ status: 'lapsed' }),
    })
    expect(writeAudit).toHaveBeenCalledWith('a1', 'Admin', 'standing_enforcement_on', 'standing.enforce', 'setting',
      { on: true, retiredShadowCards: 3 }, expect.any(String))
  })

  it('switching to the state it is already in does nothing', async () => {
    p.appSetting.findUnique.mockResolvedValue({ value: 'true', updatedAt: NOW })
    await setStandingEnforced(true, { id: 'a1', name: 'Admin' }, NOW)
    expect(p.appSetting.upsert).not.toHaveBeenCalled()
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it('levels are empty while off, and only real live cards count when on', async () => {
    expect((await standingLevelsFor(['m1'], OFF)).size).toBe(0)
    expect(p.standingCard.findMany).not.toHaveBeenCalled()
    p.standingCard.findMany.mockResolvedValue([
      { userId: 'm1', level: 'yellow', status: 'active', shadow: false },
      { userId: 'm2', level: 'red',    status: 'review', shadow: false },
    ])
    expect([...await standingLevelsFor(['m1', 'm2', 'm3'], ON)]).toEqual([['m1', 'yellow'], ['m2', 'red']])
    expect(p.standingCard.findMany.mock.calls[0][0].where).toMatchObject({ shadow: false, status: { in: ['active', 'review'] } })
  })
})

describe('resolving and recording an event', () => {
  // 18:00–20:00 Istanbul = 15:00–17:00Z
  const START = new Date('2026-10-10T15:00:00Z')
  const EVENT = {
    id: 'e1', title: 'Sunset Sailing', date: '2026-10-10', time: '18:00', endTime: '20:00',
    limitedSpots: true, totalSpots: 8, tierOverride: null, cancelCutoffHours: null, hostId: 'host', cityId: 'c1',
    city: { timezone: 'Europe/Istanbul', createdAt: new Date('2026-01-01T00:00:00Z') },
    cohosts: [{ userId: 'co' }], club: null,
  } as unknown as SweepEvent
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id, userId: id, status: 'approved', checkedIn: false, attendance: 'unknown',
    joinedAt: new Date(START.getTime() - 5 * D), cancelledAt: null, cancelledBy: null, reconfirmAskedAt: null,
    user: { role: 'member' }, ...over,
  })
  const cancelled = (id: string, hoursBefore: number) =>
    row(id, { status: 'cancelled', cancelledBy: 'member', cancelledAt: new Date(START.getTime() - hoursBefore * H) })

  it('resolves only unmarked, unscanned, approved RSVPs — as attended, stamped', async () => {
    await autoResolveAttendance('e1', NOW)
    expect(p.eventAttendee.updateMany).toHaveBeenCalledWith({
      where: { eventId: 'e1', status: 'approved', checkedIn: false, attendance: 'unknown' },
      data:  { attendance: 'attended', attendanceAutoResolvedAt: NOW },
    })
  })

  it('records declared no-shows and late cancels; forgives a refilled seat; never the people running it', async () => {
    p.eventAttendee.findMany.mockResolvedValue([
      row('ns', { attendance: 'no_show' }),
      row('came', { checkedIn: true, attendance: 'attended' }),
      row('host', { attendance: 'no_show' }),
      cancelled('late1', 10),
      cancelled('late2', 3),
      row('refill', { checkedIn: true, attendance: 'attended', joinedAt: new Date(START.getTime() - 8 * H) }),
      cancelled('ontime', 30),
    ])
    const users = await recordOffences(EVENT)
    const { data, skipDuplicates } = p.standingOffence.createMany.mock.calls[0][0]
    expect(skipDuplicates).toBe(true)
    expect(data.map((d: any) => [d.attendeeId, d.kind, d.status ?? 'open'])).toEqual([
      ['ns', 'no_show', 'open'], ['late1', 'late_cancel', 'forgiven'], ['late2', 'late_cancel', 'open'],
    ])
    expect(data[0]).toMatchObject({ userId: 'ns', eventId: 'e1', tier: 'scarce', counts: true, loggedReason: null, occurredAt: START })
    expect([...users].sort()).toEqual(['late2', 'ns'])
  })

  it('an open event\'s offences are logged, not counted', async () => {
    p.eventAttendee.findMany.mockResolvedValue([row('ns', { attendance: 'no_show' })])
    await recordOffences({ ...EVENT, limitedSpots: false, totalSpots: 60 } as SweepEvent)
    expect(p.standingOffence.createMany.mock.calls[0][0].data[0]).toMatchObject({ tier: 'open', counts: false, loggedReason: 'open_tier' })
  })

  it('writes nothing when nobody offended', async () => {
    p.eventAttendee.findMany.mockResolvedValue([row('came', { checkedIn: true, attendance: 'attended' }), row('quiet', { attendance: 'attended' })])
    expect((await recordOffences(EVENT)).size).toBe(0)
    expect(p.standingOffence.createMany).not.toHaveBeenCalled()
  })
})

describe('evaluateMember', () => {
  const off = (id: string, daysAgo: number, over: Record<string, unknown> = {}) =>
    ({ id, occurredAt: new Date(NOW.getTime() - daysAgo * D), counts: true, status: 'open', cardId: null, ...over })
  const ev  = (date: string) => ({ date, time: '19:00', endTime: '21:00', city: { timezone: 'Europe/Istanbul' } })

  it('two offences make a shadow yellow while enforcement is off', async () => {
    p.standingOffence.findMany.mockResolvedValue([off('a', 9), off('b', 3)])
    const r = await evaluateMember('m1', NOW)
    expect(p.$queryRaw).toHaveBeenCalled()
    expect(p.standingCard.create.mock.calls[0][0].data).toEqual({
      userId: 'm1', shadow: true, triggeredAt: off('b', 3).occurredAt, level: 'yellow', fromCardId: null,
    })
    expect(p.standingOffence.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } }, data: { cardId: 'card1' } })
    expect(r.issued).toEqual([{ id: 'card1', level: 'yellow', shadow: true }])
  })

  it('with enforcement on, offences from before the switch never make a card', async () => {
    p.standingOffence.findMany.mockResolvedValue([off('a', 25), off('b', 3)])
    const r = (switchedOn(), await evaluateMember('m1', NOW))
    expect(r.issued).toEqual([])
    expect(p.standingCard.create).not.toHaveBeenCalled()
    expect(p.standingCard.findMany.mock.calls[0][0].where).toMatchObject({ shadow: false })
  })

  it('three at once read as a yellow, then a red — real cards when on', async () => {
    p.standingOffence.findMany.mockResolvedValue([off('a', 9), off('b', 6), off('c', 2)])
    const r = (switchedOn(), await evaluateMember('m1', NOW))
    expect(r.issued.map(c => [c.level, c.shadow])).toEqual([['yellow', false], ['red', false]])
    expect(p.standingCard.update).toHaveBeenCalledWith({ where: { id: 'card1' }, data: expect.objectContaining({ status: 'escalated' }) })
    expect(p.standingCard.create.mock.calls[1][0].data).toMatchObject({ level: 'red', fromCardId: 'card1', triggeredAt: off('c', 2).occurredAt })
  })

  it('a pending dispute holds the card back', async () => {
    p.standingOffence.findMany.mockResolvedValue([off('a', 9), off('b', 3, { status: 'disputed' }), off('c', 2)])
    expect((await evaluateMember('m1', NOW)).issued).toEqual([])
  })

  it('two scanned commitments after the card clear a yellow; one before it does not count', async () => {
    p.standingCard.findMany.mockResolvedValue([
      { id: 'y1', level: 'yellow', status: 'active', triggeredAt: new Date(NOW.getTime() - 10 * D), issuedAt: new Date(NOW.getTime() - 9 * D), shadow: false },
    ])
    p.eventAttendee.findMany.mockResolvedValue([
      { id: 'att1',   status: 'approved', checkedIn: true, attendance: 'attended', event: ev('2026-10-14') },
      { id: 'att2',   status: 'approved', checkedIn: true, attendance: 'attended', event: ev('2026-10-17') },
      { id: 'before', status: 'approved', checkedIn: true, attendance: 'attended', event: ev('2026-10-09') },
    ])
    p.standingRecovery.findMany.mockResolvedValue([{ source: 'attendance' }, { source: 'attendance' }])
    const r = (switchedOn(), await evaluateMember('m1', NOW))
    expect(p.eventAttendee.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'm1', status: 'approved', checkedIn: true })
    expect(p.standingRecovery.createMany).toHaveBeenCalledWith({
      data: [{ cardId: 'y1', attendeeId: 'att1', source: 'attendance' }, { cardId: 'y1', attendeeId: 'att2', source: 'attendance' }],
      skipDuplicates: true,
    })
    expect(p.standingCard.update).toHaveBeenCalledWith({ where: { id: 'y1' }, data: expect.objectContaining({ status: 'cleared' }) })
    expect(r.cleared).toEqual([{ id: 'y1', shadow: false }])
  })

  it('a red with three commitments goes to review, not cleared', async () => {
    p.standingCard.findMany.mockResolvedValue([
      { id: 'r1', level: 'red', status: 'active', triggeredAt: new Date(NOW.getTime() - 20 * D), issuedAt: new Date(NOW.getTime() - 19 * D), shadow: false },
    ])
    p.standingRecovery.findMany.mockResolvedValue([{ source: 'attendance' }, { source: 'attendance' }, { source: 'attendance' }])
    const r = (switchedOn(), await evaluateMember('m1', NOW))
    expect(p.standingCard.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'review' }) })
    expect(r.review).toEqual([{ id: 'r1', shadow: false }])
    expect(r.cleared).toEqual([])
  })

  it('a card with no RSVP activity for the quiet period lapses', async () => {
    p.standingCard.findMany.mockResolvedValue([
      { id: 'y1', level: 'yellow', status: 'active', triggeredAt: new Date(NOW.getTime() - 101 * D), issuedAt: new Date(NOW.getTime() - 100 * D), shadow: false },
    ])
    p.eventAttendee.findFirst.mockResolvedValue({ joinedAt: new Date(NOW.getTime() - 95 * D) })
    const r = (switchedOn(), await evaluateMember('m1', NOW))
    expect(r.lapsed).toEqual(['y1'])
    expect(p.standingCard.update).toHaveBeenCalledWith({ where: { id: 'y1' }, data: expect.objectContaining({ status: 'lapsed' }) })
  })
})

describe('overturnOffence', () => {
  it('a red that falls hands back the yellow it escalated, and the row becomes attended', async () => {
    p.standingOffence.findUnique.mockResolvedValue({ id: 'o3', userId: 'm1', attendeeId: 'att9', kind: 'no_show', status: 'disputed', cardId: 'red1' })
    p.standingCard.findUnique.mockResolvedValue({ id: 'red1', level: 'red', status: 'active', fromCardId: 'y1' })
    expect(await overturnOffence('o3', { byId: 'mod', note: 'Was there', now: NOW })).toBe('m1')
    expect(p.eventAttendee.updateMany).toHaveBeenCalledWith({ where: { id: 'att9', attendance: 'no_show' }, data: { attendance: 'attended' } })
    expect(p.standingCard.update).toHaveBeenCalledWith({ where: { id: 'red1' }, data: expect.objectContaining({ status: 'withdrawn', resolvedById: 'mod' }) })
    expect(p.standingOffence.updateMany).toHaveBeenCalledWith({ where: { cardId: 'red1', status: { in: ['open', 'disputed'] } }, data: { cardId: null } })
    expect(p.standingCard.updateMany).toHaveBeenCalledWith({ where: { id: 'y1', status: 'escalated' }, data: { status: 'active', resolvedAt: null, resolutionNote: null } })
  })

  it('an escalated yellow takes its red down with it', async () => {
    p.standingOffence.findUnique.mockResolvedValue({ id: 'o1', userId: 'm1', attendeeId: 'att1', kind: 'late_cancel', status: 'open', cardId: 'y1' })
    p.standingCard.findUnique.mockResolvedValue({ id: 'y1', level: 'yellow', status: 'escalated', fromCardId: null })
    p.standingCard.findMany.mockResolvedValue([{ id: 'red1' }])
    await overturnOffence('o1', { byId: 'mod', note: 'x', now: NOW })
    const withdrawn = p.standingCard.update.mock.calls.map((c: any) => c[0].where.id)
    expect(withdrawn).toEqual(['red1', 'y1'])
    // A late cancel is a timestamp: no attendance to rewrite.
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })

  it('returns null and touches no card when nothing was open to overturn', async () => {
    p.standingOffence.findUnique.mockResolvedValue({ id: 'o1', userId: 'm1', attendeeId: 'att1', kind: 'no_show', status: 'overturned', cardId: 'y1' })
    p.standingOffence.updateMany.mockResolvedValue({ count: 0 })
    expect(await overturnOffence('o1', { byId: 'mod', note: 'x', now: NOW })).toBeNull()
    expect(p.standingCard.findUnique).not.toHaveBeenCalled()
  })
})

describe('disputeOffence', () => {
  it('is closed while standing is switched off — members have nothing to dispute yet', async () => {
    expect(await disputeOffence('o1', 'm1', 'I was there', NOW)).toBe('not_enforced')
    expect(p.standingOffence.findUnique).not.toHaveBeenCalled()
  })

  it('opens a dispute on the member\'s own recent no-show only', async () => {
    p.appSetting.findUnique.mockResolvedValue({ value: 'true', updatedAt: ON.since })
    p.standingOffence.findUnique.mockResolvedValueOnce({ userId: 'm1', kind: 'no_show', status: 'open', occurredAt: new Date(NOW.getTime() - 2 * D) })
    expect(await disputeOffence('o1', 'm1', '  I was at the back  ', NOW)).toBe('ok')
    expect(p.standingOffence.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', userId: 'm1', status: 'open', disputedAt: null },
      data:  { status: 'disputed', disputedAt: NOW, disputeNote: 'I was at the back' },
    })
    // Upheld once already: not a second time.
    p.standingOffence.findUnique.mockResolvedValueOnce({ userId: 'm1', kind: 'no_show', status: 'open', occurredAt: NOW, disputedAt: new Date(NOW.getTime() - D) })
    expect(await disputeOffence('o1', 'm1', 'x', NOW)).toBe('not_allowed')
    p.standingOffence.findUnique.mockResolvedValueOnce({ userId: 'someone', kind: 'no_show', status: 'open', occurredAt: NOW })
    expect(await disputeOffence('o1', 'm1', 'x', NOW)).toBe('not_found')
    p.standingOffence.findUnique.mockResolvedValueOnce({ userId: 'm1', kind: 'late_cancel', status: 'open', occurredAt: NOW })
    expect(await disputeOffence('o1', 'm1', 'x', NOW)).toBe('not_allowed')
  })
})
