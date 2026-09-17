import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('@/lib/notify', () => ({ createNotification: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/audit',  () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/rateLimit', () => ({ claimOnce: vi.fn(), releaseClaim: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendAttendanceCheckEmail: vi.fn().mockResolvedValue(undefined), sendNoShowRecordedEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:     vi.fn(),
  $queryRaw:        vi.fn(),
  appSetting:       { findUnique: vi.fn(), upsert: vi.fn() },
  standingCard:     { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  standingOffence:  { findMany: vi.fn(), findUnique: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  standingRecovery: { createMany: vi.fn(), findMany: vi.fn() },
  eventAttendee:    { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  event:            { findMany: vi.fn(), findUnique: vi.fn() },
  rateLimit:        { findUnique: vi.fn(), findMany: vi.fn() },
  user:             { findMany: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notify'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { sendAttendanceCheckEmail, sendNoShowRecordedEmail } from '@/lib/email'
import {
  standingEnforcement, setStandingEnforced, standingLevelsFor, settleAttendance, sendAttendanceReviews, notifyNoShows,
  resolvedEvents, reviewingEvents, recordOffences, evaluateMember, overturnOffence, disputeOffence, type SweepEvent,
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
  p.event.findUnique.mockResolvedValue({ emoji: '⛵' })
  ;(claimOnce as any).mockResolvedValue(true)
  // The review went out: its claim is live.
  p.rateLimit.findUnique.mockResolvedValue({ resetAt: new Date(NOW.getTime() + D) })
  p.rateLimit.findMany.mockResolvedValue([])
  p.user.findMany.mockResolvedValue([])
  ;(sendAttendanceCheckEmail as any).mockResolvedValue(undefined)
  ;(sendNoShowRecordedEmail as any).mockResolvedValue(undefined)
  ;(createNotification as any).mockResolvedValue(true)
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

  const room = (checked: number, unmarked: string[], extra: ReturnType<typeof row>[] = []) => [
    ...Array.from({ length: checked }, (_, i) => row(`in${i}`, { checkedIn: true, attendance: 'attended', user: { role: 'member', name: `In ${i}` } })),
    ...unmarked.map(id => row(id, { user: { role: 'member', name: `Guest ${id}` } })),
    ...extra,
  ]
  const updates = () => p.eventAttendee.updateMany.mock.calls.map((c: any) => c[0])

  it('check-in ran: the unmarked guests become no-shows, stamped; the people running it attended', async () => {
    p.eventAttendee.findMany.mockResolvedValue(room(6, ['a', 'b'], [row('host'), row('ex', { attendance: 'excused' })]))
    await settleAttendance(EVENT, NOW)
    const still = { status: 'approved', checkedIn: false, attendance: 'unknown' }
    expect(updates()).toContainEqual({ where: { id: { in: ['a', 'b'] }, ...still }, data: { attendance: 'no_show', attendanceAutoResolvedAt: NOW } })
    expect(updates()).toContainEqual({ where: { id: { in: ['host'] }, ...still }, data: { attendance: 'attended', attendanceAutoResolvedAt: NOW } })
    // An excused guest is left as the host left it.
    expect(JSON.stringify(updates())).not.toContain('"ex"')
  })

  it('check-in not run (under half the room scanned): nobody is penalised, the room is attended', async () => {
    p.eventAttendee.findMany.mockResolvedValue(room(2, ['a', 'b', 'c']))
    await settleAttendance(EVENT, NOW)
    expect(updates()).toHaveLength(1)
    expect(updates()[0]).toMatchObject({ where: { id: { in: ['a', 'b', 'c'] } }, data: { attendance: 'attended' } })
  })

  it('excusing guests never tips the room over half', async () => {
    // 3 scanned of 7 with 2 excused is still 3 of 7.
    p.eventAttendee.findMany.mockResolvedValue(room(3, ['a', 'b'], [row('x1', { attendance: 'excused' }), row('x2', { attendance: 'excused' })]))
    await settleAttendance(EVENT, NOW)
    expect(JSON.stringify(updates())).not.toContain('no_show')
  })

  it('no review ever went out: the room settles as attended', async () => {
    p.rateLimit.findUnique.mockResolvedValue(null)
    p.eventAttendee.findMany.mockResolvedValue(room(6, ['a', 'b']))
    await settleAttendance(EVENT, NOW)
    expect(JSON.stringify(updates())).not.toContain('no_show')
    expect(p.rateLimit.findUnique).toHaveBeenCalledWith({ where: { key: 'attendance-review-sent:e1' }, select: { resetAt: true } })
  })

  it('settles to no-show once: a guest added after the room settled is attended', async () => {
    ;(claimOnce as any).mockResolvedValue(false)
    p.eventAttendee.findMany.mockResolvedValue(room(6, ['late']))
    await settleAttendance(EVENT, NOW)
    expect(updates()).toEqual([expect.objectContaining({ where: expect.objectContaining({ id: { in: ['late'] } }), data: { attendance: 'attended', attendanceAutoResolvedAt: NOW } })])
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

describe('the host review', () => {
  // Sunset Sailing, Sat 10 Oct 18:00–20:00 Istanbul: the list goes Sun 11 Oct
  // 10:00 (07:00Z), the room settles Mon 12 Oct 00:00 (Sun 21:00Z).
  const EVENT = {
    id: 'e1', title: 'Sunset Sailing', date: '2026-10-10', time: '18:00', endTime: '20:00',
    limitedSpots: true, totalSpots: 8, tierOverride: null, cancelCutoffHours: null, hostId: 'host', cityId: 'c1',
    city: { timezone: 'Europe/Istanbul', createdAt: new Date('2026-01-01T00:00:00Z') },
    cohosts: [{ userId: 'co' }], club: null,
  }
  const guest = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, userId: id, checkedIn: false, attendance: 'unknown', user: { role: 'member', name: id, email: `${id}@x` }, ...over })
  const scanned = (id: string) => guest(id, { checkedIn: true, attendance: 'attended' })

  it('reviews from 10:00 the day after until midnight, then settles', async () => {
    p.event.findMany.mockResolvedValue([EVENT])
    expect(await reviewingEvents(new Date('2026-10-11T06:59:00Z'))).toHaveLength(0)
    expect(await reviewingEvents(new Date('2026-10-11T07:00:00Z'))).toHaveLength(1)
    expect(await resolvedEvents(new Date('2026-10-11T20:59:00Z'))).toHaveLength(0)
    expect(await reviewingEvents(new Date('2026-10-11T21:00:00Z'))).toHaveLength(0)
    expect(await resolvedEvents(new Date('2026-10-11T21:00:00Z'))).toHaveLength(1)
  })

  it('gives the 16 September events their review on 18 September', async () => {
    const wed = { ...EVENT, date: '2026-09-16', time: '19:30', endTime: null }
    p.event.findMany.mockResolvedValue([wed])
    expect(await resolvedEvents(new Date('2026-09-17T21:50:00Z'))).toHaveLength(0)
    expect(await reviewingEvents(new Date('2026-09-17T21:50:00Z'))).toHaveLength(0)
    expect(await reviewingEvents(new Date('2026-09-18T07:50:00Z'))).toHaveLength(1)
    expect(await resolvedEvents(new Date('2026-09-18T21:50:00Z'))).toHaveLength(1)
  })

  it('sends everyone running the door, club hosts and admins who checked people in included, and records that it went', async () => {
    p.eventAttendee.findMany.mockResolvedValue([scanned('s1'), guest('a')])
    p.rateLimit.findMany.mockResolvedValue([{ key: 'checkin-door:e1:admin1' }, { key: 'checkin-door:e1:host' }])
    await sendAttendanceReviews({ ...EVENT, cohosts: [], club: { memberships: [{ userId: 'clubhost' }] } } as unknown as SweepEvent)
    expect(p.rateLimit.findMany.mock.calls[0][0].where).toEqual({ key: { startsWith: 'checkin-door:e1:' } })
    expect((createNotification as any).mock.calls.map((c: any) => c[0])).toEqual(['host', 'clubhost', 'admin1', 'a'])
    expect((claimOnce as any).mock.calls.map((c: any) => c[0])).toContain('attendance-review-sent:e1')
  })

  it('sends the host and co-host the unmarked names, once each', async () => {
    p.eventAttendee.findMany.mockResolvedValue([scanned('s1'), scanned('s2'), scanned('s3'), guest('Emir'), guest('Beto'), guest('host')])
    expect(await sendAttendanceReviews(EVENT as unknown as SweepEvent)).toBe(2)
    const calls = (createNotification as any).mock.calls
    expect(calls.map((c: any) => c[0])).toEqual(['host', 'co', 'Emir', 'Beto'])
    expect(calls[2][1]).toBe('attendance_check')
    expect((sendAttendanceCheckEmail as any).mock.calls.map((c: any) => c[0])).toEqual(['Emir@x', 'Beto@x'])
    expect(calls[2][2]).toBe("⛵ You weren't checked in at Sunset Sailing")
    expect(calls[2][4]).toBe('/events/e1')
    expect(calls[0][1]).toBe('attendance_review')
    expect(calls[0][2]).toBe('⛵ 2 not checked in at Sunset Sailing')
    expect(calls[0][3]).toBe('Emir and Beto. Check in anyone who came, or excuse them, by midnight tonight. After that each counts as a no-show.')
    expect(calls[0][4]).toBe('/host/checkin?event=e1')
    expect((claimOnce as any).mock.calls.map((c: any) => c[0])).toEqual([
      'attendance-review:e1:host', 'attendance-review:e1:co', 'attendance-review-sent:e1',
      'attendance-review-guest:e1:Emir', 'attendance-review-guest:e1:Beto',
    ])
  })

  it('a later sweep still reaches a guest the first one missed, once the host list has gone', async () => {
    p.eventAttendee.findMany.mockResolvedValue([scanned('s1'), guest('a')])
    ;(claimOnce as any).mockImplementation(async (k: string) => k.startsWith('attendance-review-guest:'))
    await sendAttendanceReviews(EVENT as unknown as SweepEvent)
    expect((createNotification as any).mock.calls.map((c: any) => c[0])).toEqual(['a'])
  })

  it('where the no-show would not count, the host still gets the list, worded for what will happen, and no guest is told', async () => {
    p.eventAttendee.findMany.mockResolvedValue([scanned('s1'), guest('a')])
    await sendAttendanceReviews({ ...EVENT, limitedSpots: false } as unknown as SweepEvent)
    await sendAttendanceReviews({ ...EVENT, id: 'e2', city: { timezone: 'Europe/Istanbul', createdAt: new Date('2026-09-01T00:00:00Z') } } as unknown as SweepEvent)
    const calls = (createNotification as any).mock.calls
    expect(calls.map((c: any) => c[1])).not.toContain('attendance_check')
    expect([...new Set(calls.filter((c: any) => c[1] === 'attendance_review').map((c: any) => c[3]))]).toEqual([
      "a. Check in anyone who came, or excuse them, by midnight tonight. After that it goes on the record as a no-show, though it doesn't count on an open event.",
      'a. Check in anyone who came, or excuse them, by midnight tonight. After that it goes on the record as a no-show, though nothing counts against anyone in a new city yet.',
    ])
    expect(calls.filter((c: any) => c[1] === 'attendance_review')).toHaveLength(4)
  })

  it('sends nothing where check-in was not run, or everyone is marked', async () => {
    p.eventAttendee.findMany.mockResolvedValueOnce([scanned('s1'), guest('a'), guest('b')])
    expect(await sendAttendanceReviews(EVENT as unknown as SweepEvent)).toBe(0)
    p.eventAttendee.findMany.mockResolvedValueOnce([scanned('s1'), guest('a', { attendance: 'excused' })])
    expect(await sendAttendanceReviews(EVENT as unknown as SweepEvent)).toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('hands the claim back when a send fails, and tells no guest when no host heard', async () => {
    p.eventAttendee.findMany.mockResolvedValue([scanned('s1'), guest('a')])
    ;(createNotification as any).mockResolvedValue(false)
    p.rateLimit.findUnique.mockResolvedValue(null)
    await sendAttendanceReviews({ ...EVENT, cohosts: [] } as unknown as SweepEvent)
    expect(releaseClaim).toHaveBeenCalledWith('attendance-review:e1:host')
    expect((createNotification as any).mock.calls.map((c: any) => c[0])).toEqual(['host'])
  })

  it('tells a member about a counting no-show once, and says which kind', async () => {
    p.standingOffence.findMany.mockResolvedValue([
      { id: 'o1', userId: 'm1', event: { title: 'Sunset Sailing', emoji: '⛵' }, attendee: { attendanceAutoResolvedAt: NOW }, user: { name: 'M One', email: 'm1@x' } },
      { id: 'o2', userId: 'm2', event: { title: 'Sunset Sailing', emoji: '⛵' }, attendee: { attendanceAutoResolvedAt: null }, user: { name: 'M Two', email: null } },
    ])
    expect(await notifyNoShows(['e1'], OFF)).toBe(0)
    expect(await notifyNoShows(['e1'], ON)).toBe(2)
    expect(p.standingOffence.findMany.mock.calls[0][0].where).toMatchObject({ kind: 'no_show', counts: true, status: 'open', occurredAt: { gte: ON.since } })
    const calls = (createNotification as any).mock.calls
    expect(calls[0][3]).toMatch(/^You weren't checked in/)
    expect(calls[1][3]).toMatch(/^The host marked you absent/)
    expect(calls[0][4]).toBe('/standing')
    expect((sendNoShowRecordedEmail as any).mock.calls).toEqual([['m1@x', 'M One', 'Sunset Sailing', '⛵', true]])
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

  it('a card lapses 90 days after its last counting offence, however many unchecked events they came to', async () => {
    const card = { id: 'y1', level: 'yellow', status: 'active', triggeredAt: new Date(NOW.getTime() - 101 * D), issuedAt: new Date(NOW.getTime() - 100 * D), shadow: false }
    p.standingCard.findMany.mockResolvedValue([card])
    p.standingOffence.findMany.mockResolvedValue([{ id: 'o1', occurredAt: new Date(NOW.getTime() - 95 * D), counts: true, status: 'open', cardId: 'y1', disputedAt: null }])
    // Coming to events nobody checked in is no RSVP activity the old rule saw
    // either way; it must not matter.
    p.eventAttendee.findFirst.mockResolvedValue({ joinedAt: new Date(NOW.getTime() - 2 * D) })
    const r = (switchedOn(), await evaluateMember('m1', NOW))
    expect(r.lapsed).toEqual(['y1'])
    expect(p.standingCard.update).toHaveBeenCalledWith({ where: { id: 'y1' }, data: expect.objectContaining({ status: 'lapsed' }) })
  })

  it('a newer counting offence keeps the card from lapsing', async () => {
    p.standingCard.findMany.mockResolvedValue([
      { id: 'y1', level: 'yellow', status: 'active', triggeredAt: new Date(NOW.getTime() - 101 * D), issuedAt: new Date(NOW.getTime() - 100 * D), shadow: false },
    ])
    p.standingOffence.findMany.mockResolvedValue([{ id: 'o2', occurredAt: new Date(NOW.getTime() - 10 * D), counts: true, status: 'open', cardId: 'y1', disputedAt: null }])
    const r = (switchedOn(), await evaluateMember('m1', NOW))
    expect(r.lapsed).toEqual([])
  })

  it('a dispute holds a new card for a week, then the ledger stands', async () => {
    const off = (id: string, daysAgo: number, disputed: number | null) =>
      ({ id, occurredAt: new Date(NOW.getTime() - daysAgo * D), counts: true, status: disputed === null ? 'open' : 'disputed', cardId: null, disputedAt: disputed === null ? null : new Date(NOW.getTime() - disputed * D) })
    switchedOn()
    // Two open offences would be a yellow; a third, disputed two days ago, holds it.
    p.standingOffence.findMany.mockResolvedValue([off('a', 10, null), off('b', 5, null), off('c', 3, 2)])
    expect((await evaluateMember('m1', NOW)).issued).toEqual([])
    // A week on, nobody has decided: the two open ones card as they would have.
    // The disputed one itself still doesn't count until it is decided.
    p.standingOffence.findMany.mockResolvedValue([off('a', 10, null), off('b', 5, null), off('c', 3, 8)])
    const r = await evaluateMember('m1', NOW)
    expect(r.issued).toHaveLength(1)
    expect(p.standingOffence.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } }, data: { cardId: 'card1' } })
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
    p.standingOffence.findUnique.mockResolvedValueOnce({ userId: 'm1', kind: 'no_show', status: 'open', occurredAt: new Date(NOW.getTime() - 2 * D), event: { title: 'Sunset Sailing', cityId: 'c1' } })
    p.user.findMany.mockResolvedValueOnce([{ id: 'adm' }, { id: 'mod' }])
    expect(await disputeOffence('o1', 'm1', '  I was at the back  ', NOW)).toBe('ok')
    expect(p.user.findMany.mock.calls[0][0].where).toEqual({ status: 'approved', OR: [{ role: 'admin' }, { role: 'moderator', cityId: 'c1' }] })
    expect((createNotification as any).mock.calls.map((c: any) => [c[0], c[1], c[4]])).toEqual([['adm', 'standing_dispute', '/admin/standing'], ['mod', 'standing_dispute', '/admin/standing']])
    expect(p.standingOffence.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', userId: 'm1', status: 'open', disputedAt: null },
      data:  { status: 'disputed', disputedAt: NOW, disputeNote: 'I was at the back' },
    })
    // Upheld once already: not a second time.
    p.standingOffence.findUnique.mockResolvedValueOnce({ userId: 'm1', kind: 'no_show', status: 'open', occurredAt: NOW, disputedAt: new Date(NOW.getTime() - D), event: { title: 'x', cityId: 'c1' } })
    expect(await disputeOffence('o1', 'm1', 'x', NOW)).toBe('not_allowed')
    p.standingOffence.findUnique.mockResolvedValueOnce({ userId: 'someone', kind: 'no_show', status: 'open', occurredAt: NOW, event: { title: 'x', cityId: 'c1' } })
    expect(await disputeOffence('o1', 'm1', 'x', NOW)).toBe('not_found')
    p.standingOffence.findUnique.mockResolvedValueOnce({ userId: 'm1', kind: 'late_cancel', status: 'open', occurredAt: NOW, event: { title: 'x', cityId: 'c1' } })
    expect(await disputeOffence('o1', 'm1', 'x', NOW)).toBe('not_allowed')
  })
})
