import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Fifth scan, batch 34 — seat capacity and postponed events. The production
// audit found 13 limited events with more approved seats than spots, and 20
// seats on a postponed event with no new date outside every automated handling.
//   a. staff approve refuses past the cap (409 over_capacity) unless the
//      request carries allowOverCapacity: true — counted under the row lock
//   b. manual add and waitlist promote: the same rule
//   c. the promotion after a removal only fills a seat that is really free
//   d. event edit refuses tightening the cap under the seats held (400 with
//      the count), never writes spotsLeft from the body, checks and re-derives
//      series occurrences on "apply to series"
//   e. restore brings seats back up to the cap; the rest are waitlisted
//   f. co-host changes re-derive the counter the RSVP gate reads
//   g. lib/eventCapacity verdicts
//   h. lib/admin/overCapacity: ask once, override only on a yes
//   i. staff pages send the override only through the confirm (source pins)
//   j. postponed events: timeline, dashboard, once-per-14-days host reminder
//   k. reminder / no-show / payment / survey sweeps skip postponed events
//   l. scripts/audit-overcapacity-events.ts and audit-postponed-events.ts

const read = (p: string) => readFileSync(p, 'utf8')

const h = vi.hoisted(() => {
  const prisma = {
    $transaction:  vi.fn(),
    $queryRaw:     vi.fn(),
    event:         { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    eventAttendee: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    eventCoHost:   { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    waitlistEntry: { findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(), create: vi.fn(), count: vi.fn() },
    payment:       { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    paymentLog:    { create: vi.fn(), createMany: vi.fn() },
    user:          { findUnique: vi.fn(), findMany: vi.fn() },
    city:          { findMany: vi.fn(), findUnique: vi.fn() },
    auditLog:      { findMany: vi.fn() },
    noShowCard:    { findMany: vi.fn() },
    tagGroup:      { findMany: vi.fn() },
  }
  return {
    prisma,
    getSession:         vi.fn(),
    createNotification: vi.fn(),
    claimOnce:          vi.fn(),
    releaseClaim:       vi.fn(),
    recompute:          vi.fn(),
    confirmToast:       vi.fn(),
    findPromotable:     vi.fn(),
    city: { citiesByToday: vi.fn(), todayInCity: vi.fn(), getCityTz: vi.fn(), resolveCityId: vi.fn() },
  }
})

vi.mock('@/lib/prisma',         () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',        () => ({ getSession: h.getSession }))
vi.mock('@/lib/rateLimit',      () => ({ rateLimit: vi.fn(async () => true), claimOnce: h.claimOnce, releaseClaim: h.releaseClaim }))
vi.mock('@/lib/notify',         () => ({ createNotification: h.createNotification, notifyNewEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/city',           () => h.city)
vi.mock('@/lib/cronHealth',     () => ({ recordCronRun: vi.fn() }))
vi.mock('@/lib/confirmToast',   () => ({ confirmToast: h.confirmToast }))
vi.mock('@/lib/access', () => ({
  isAdmin:            (s: any) => s?.role === 'admin',
  isModerator:        (s: any) => s?.role === 'moderator',
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
  isClubHost:         vi.fn(async () => false),
  isClubHostFor:      vi.fn(async () => false),
  hostCityIds:        vi.fn(async () => []),
  canManageEventOps:  vi.fn(async () => true),
  canActInCity:       vi.fn(() => true),
}))
vi.mock('@/lib/email', () => ({
  sendEventApprovedEmail:  vi.fn(async () => {}),
  sendEventRejectedEmail:  vi.fn(async () => {}),
  sendEventCancelledEmail: vi.fn(async () => {}),
  sendSpotOpenedEmail:     vi.fn(async () => {}),
  recordEmailFailure:      vi.fn(async () => {}),
}))
vi.mock('@/lib/audit',          () => ({ writeAudit: vi.fn(), getDiff: vi.fn(() => null) }))
vi.mock('@/lib/autoJoinClub',   () => ({ autoJoinClub: vi.fn(async () => {}) }))
vi.mock('@/lib/spotsLeft',      () => ({ recomputeSpotsLeft: h.recompute, expectedSpotsLeft: vi.fn(async () => 0) }))
vi.mock('@/lib/rsvpConfirmed', () => ({
  createSeatPayment: vi.fn(async () => true), backfillSeatPayments: vi.fn(async () => 0),
  collectsSeatPayment: vi.fn(() => false), announceConfirmedSeat: vi.fn(), LIVE_PAYMENT_STATUSES: ['pending', 'paid'],
}))
vi.mock('@/lib/eventQuota', () => ({
  findPromotableFromWaitlist: h.findPromotable, hasQuotaRoomFor: vi.fn(async () => ({ ok: true })), quotaEventSelect: {},
}))
vi.mock('@/lib/noShow', () => ({
  getRsvpGate: vi.fn(async () => ({ ok: true })), gateErrorBody: vi.fn(), waiveCard: vi.fn(),
  checkRsvpAllowed: vi.fn(async () => ({ ok: true })), recordYellowAcknowledgement: vi.fn(),
}))

import { DELETE as participantsDELETE, PATCH as participantsPATCH, POST as participantsPOST, PUT as participantsPUT } from '@/app/api/admin/events/[id]/participants/route'
import { PUT as eventPUT } from '@/app/api/admin/events/[id]/route'
import { POST as cohostPOST, DELETE as cohostDELETE } from '@/app/api/admin/events/[id]/cohosts/route'
import { POST as paymentSweepPOST } from '@/app/api/cron/sweep-payment-reminders/route'
import { POST as waitlistSweepPOST } from '@/app/api/cron/sweep-waitlists/route'
import { restoreSeatsReleasedByCancel, splitRestoredSeats } from '@/lib/eventRestore'
import { seatVerdict, shrinkVerdict, wantsOverCapacity } from '@/lib/eventCapacity'
import { capacityRefusal, withCapacityConfirm, capacityConfirmForBatch } from '@/lib/admin/overCapacity'
import { postponedTimeline, planPostponed, loadPostponedEvents, type PostponedFacts } from '@/lib/postponedEvents'
import { remindHostsOfPostponedEvents, postponedReminderKey } from '@/lib/postponedReminder'
import { needsReconfirmation } from '@/lib/reconfirm'
import { planOvercapacity, type CapacityFacts } from '@/scripts/audit-overcapacity-events'
import { summarizePostponed, describePostponed } from '@/scripts/audit-postponed-events'

const p = h.prisma as any
const params = { params: Promise.resolve({ id: 'e1' }) } as any
const req = (body: unknown) => ({ json: async () => body }) as any
const cronReq = () => new Request('http://x/api', { headers: { 'x-cron-secret': 'sek', authorization: 'Bearer sek' } }) as any
const DAY = 86_400_000

const ev = {
  id: 'e1', title: 'Picnic', status: 'published', hostId: 'host', cohosts: [{ userId: 'co1' }], cityId: 'c1',
  date: '2026-09-20', time: '19:00', endTime: null, neighborhood: 'Moda', location: 'Moda', emoji: '🧺', clubId: null,
  totalSpots: 10, spotsLeft: 0, limitedSpots: true, approvalRequired: true, soldOut: false,
  price: 0, memberPrice: null, payTo: 'venue', currency: 'TRY', isPremium: false, membersOnly: false, isFirstTimerFriendly: false,
  genderBalance: false, maleQuota: null, femaleQuota: null, turkishMaleQuota: null, seriesId: null, cancelledAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'sek'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
  p.$transaction.mockImplementation(async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(p))
  p.$queryRaw.mockResolvedValue([])
  p.event.findUnique.mockResolvedValue(ev)
  p.event.findMany.mockResolvedValue([])
  p.event.update.mockImplementation(async ({ data }: any) => ({ ...ev, ...data }))
  p.event.updateMany.mockResolvedValue({ count: 1 })
  p.eventAttendee.findMany.mockResolvedValue([])
  p.eventAttendee.update.mockResolvedValue({})
  p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
  p.eventAttendee.count.mockResolvedValue(0)
  p.eventCoHost.findMany.mockResolvedValue([])
  p.eventCoHost.upsert.mockResolvedValue({ id: 'ch1' })
  p.eventCoHost.deleteMany.mockResolvedValue({ count: 1 })
  p.waitlistEntry.findMany.mockResolvedValue([])
  p.waitlistEntry.deleteMany.mockResolvedValue({ count: 0 })
  p.payment.findMany.mockResolvedValue([])
  p.auditLog.findMany.mockResolvedValue([])
  p.user.findUnique.mockResolvedValue({ name: 'Ada', email: 'ada@x.test', gender: null, nationality: null, status: 'approved' })
  p.user.findMany.mockResolvedValue([])
  h.getSession.mockResolvedValue({ id: 'adm', name: 'Admin', role: 'admin', cityId: 'c1' })
  h.createNotification.mockResolvedValue(true)
  h.claimOnce.mockResolvedValue(true)
  h.recompute.mockResolvedValue(undefined)
  h.city.todayInCity.mockResolvedValue('2026-09-14')
  h.city.getCityTz.mockResolvedValue('Europe/Istanbul')
  h.city.citiesByToday.mockImplementation(async (off = 0) => [{ date: new Date(Date.UTC(2026, 8, 14) + off * DAY).toISOString().slice(0, 10), cityIds: ['c1'] }])
})
afterEach(() => vi.useRealTimers())

const lockedBeforeCount = () =>
  expect(p.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(p.eventAttendee.count.mock.invocationCallOrder[0])

// ── a ──────────────────────────────────────────────────────────────────────
describe('a. staff approve: refused past the cap unless explicitly overridden', () => {
  beforeEach(() => { p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' }) })

  it('a full limited event answers 409 over_capacity with the count, seats nobody, counted under the lock', async () => {
    p.eventAttendee.count.mockResolvedValue(10)
    const res = await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'over_capacity', approved: 10, totalSpots: 10 })
    expect(p.eventAttendee.update).not.toHaveBeenCalled()
    expect(h.recompute).not.toHaveBeenCalled()
    expect(h.createNotification).not.toHaveBeenCalled()
    lockedBeforeCount()
    expect(p.eventAttendee.count.mock.calls[0][0].where).toEqual({ eventId: 'e1', status: 'approved', NOT: { userId: { in: ['host', 'co1'] } } })
  })

  it('only a literal allowOverCapacity: true overrides — and then the seat and counter are written in the lock', async () => {
    p.eventAttendee.count.mockResolvedValue(10)
    expect((await participantsPATCH(req({ userId: 'u1', action: 'approve', allowOverCapacity: 'true' }), params)).status).toBe(409)
    const res = await participantsPATCH(req({ userId: 'u1', action: 'approve', allowOverCapacity: true }), params)
    expect(res.status).toBe(200)
    // The seat dates from the approval (standing's late-seat rule reads joinedAt).
    expect(p.eventAttendee.update).toHaveBeenCalledWith({ where: { userId_eventId: { userId: 'u1', eventId: 'e1' } }, data: { status: 'approved', joinedAt: expect.any(Date) } })
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
  })

  it('a free seat needs no override; a co-host takes no seat; an unlimited event is never counted', async () => {
    p.eventAttendee.count.mockResolvedValue(9)
    expect((await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)).status).toBe(200)
    p.eventAttendee.count.mockResolvedValue(10)
    expect((await participantsPATCH(req({ userId: 'co1', action: 'approve' }), params)).status).toBe(200)
    p.eventAttendee.count.mockClear()
    p.event.findUnique.mockResolvedValue({ ...ev, limitedSpots: false })
    expect((await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)).status).toBe(200)
    expect(p.eventAttendee.count).not.toHaveBeenCalled()
  })
})

// ── b ──────────────────────────────────────────────────────────────────────
describe('b. manual add and waitlist promote: the same rule', () => {
  beforeEach(() => {
    p.eventAttendee.findUnique.mockResolvedValue(null)
    p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
    p.eventAttendee.count.mockResolvedValue(10)
  })

  it('add (PUT) past the cap → 409, nothing written; with the override → seated and re-derived in the lock', async () => {
    const res = await participantsPUT(req({ userId: 'u1' }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('over_capacity')
    expect(p.waitlistEntry.deleteMany).not.toHaveBeenCalled()
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    lockedBeforeCount()

    expect((await participantsPUT(req({ userId: 'u1', allowOverCapacity: true }), params)).status).toBe(200)
    expect(p.eventAttendee.updateMany.mock.calls[0][0].data.status).toBe('approved')
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
  })

  it('promote (POST) past the cap → 409, still on the waitlist; with the override → promoted', async () => {
    const res = await participantsPOST(req({ userId: 'u1' }), params)
    expect(res.status).toBe(409)
    expect(p.waitlistEntry.deleteMany).not.toHaveBeenCalled()
    expect((await participantsPOST(req({ userId: 'u1', allowOverCapacity: true }), params)).status).toBe(200)
    expect(p.waitlistEntry.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'e1', userId: 'u1' } })
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
  })
})

// ── c ──────────────────────────────────────────────────────────────────────
describe('c. removing a seat promotes only into a seat that is really free', () => {
  beforeEach(() => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    h.findPromotable.mockResolvedValue({ id: 'w9', userId: 'u9' })
  })

  it('an event still over its cap after the removal promotes nobody, and re-derives the counter in the lock', async () => {
    p.eventAttendee.count.mockResolvedValue(11)
    expect((await participantsDELETE(req({ userId: 'u1' }), params)).status).toBe(200)
    expect(p.waitlistEntry.delete).not.toHaveBeenCalled()
    expect(h.createNotification).not.toHaveBeenCalledWith('u9', 'waitlist_promoted', expect.anything(), expect.anything(), expect.anything())
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
  })

  it('with a seat free the next eligible person is promoted and told', async () => {
    p.eventAttendee.count.mockResolvedValue(9)
    await participantsDELETE(req({ userId: 'u1' }), params)
    expect(p.waitlistEntry.delete).toHaveBeenCalledWith({ where: { id: 'w9' } })
    expect(h.createNotification).toHaveBeenCalledWith('u9', 'waitlist_promoted', expect.any(String), expect.any(String), '/events/e1')
  })
})

// ── d ──────────────────────────────────────────────────────────────────────
describe('d. event edit and the cap', () => {
  const before = { ...ev, approvalRequired: false }
  beforeEach(() => { p.event.findUnique.mockResolvedValue(before) })

  it('lowering totalSpots under the seats held → 400 with the count; nothing written', async () => {
    p.eventAttendee.count.mockResolvedValue(9)
    const res = await eventPUT(req({ totalSpots: 8 }), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'below_approved_seats', approved: 9, totalSpots: 8 })
    expect(body.error).toContain('9 members already hold seats')
    expect(p.event.update).not.toHaveBeenCalled()
    lockedBeforeCount()
  })

  it('with the override it saves, and spotsLeft is re-derived from the seats inside the lock', async () => {
    p.eventAttendee.count.mockResolvedValue(9)
    const res = await eventPUT(req({ totalSpots: 8, allowOverCapacity: true }), params)
    expect(res.status).toBe(200)
    expect(p.event.update.mock.calls[0][0].data.totalSpots).toBe(8)
    expect(h.recompute).toHaveBeenCalledWith('e1', 8, p)
  })

  it('raising a cap that is still under the seats, or resending it unchanged, is not refused', async () => {
    p.eventAttendee.count.mockResolvedValue(15)
    expect((await eventPUT(req({ totalSpots: 12 }), params)).status).toBe(200)
    expect((await eventPUT(req({ totalSpots: 10, title: 'Picnic' }), params)).status).toBe(200)
  })

  it('switching limited spots on under the seats held is a tightening too', async () => {
    p.event.findUnique.mockResolvedValue({ ...before, limitedSpots: false })
    p.eventAttendee.count.mockResolvedValue(12)
    const res = await eventPUT(req({ limitedSpots: true }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).approved).toBe(12)
  })

  it('a spotsLeft in the body is never written', async () => {
    await eventPUT(req({ spotsLeft: 4, title: 'Picnic in Moda' }), params)
    expect(p.event.update).toHaveBeenCalledTimes(1)
    expect('spotsLeft' in p.event.update.mock.calls[0][0].data).toBe(false)
  })

  describe('apply to series', () => {
    const sibling = { id: 'e2', title: 'Picnic', date: '2026-09-27', totalSpots: 10, limitedSpots: true }
    beforeEach(() => {
      p.event.findUnique.mockResolvedValue({ ...before, seriesId: 's1' })
      p.event.findMany.mockResolvedValue([sibling])
    })

    it('an occurrence that would fall under its own seats refuses the whole save, naming it', async () => {
      p.eventAttendee.count.mockImplementation(async ({ where }: any) => where.eventId === 'e2' ? 9 : 3)
      const res = await eventPUT(req({ totalSpots: 8, applyToSeries: true }), params)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('"Picnic" on 2026-09-27')
      expect(p.event.update).not.toHaveBeenCalled()
      expect(p.event.updateMany).not.toHaveBeenCalled()
    })

    it('otherwise every occurrence gets the cap and its own counter re-derived', async () => {
      p.eventAttendee.count.mockImplementation(async ({ where }: any) => where.eventId === 'e2' ? 6 : 3)
      expect((await eventPUT(req({ totalSpots: 8, applyToSeries: true }), params)).status).toBe(200)
      expect(p.event.updateMany).toHaveBeenCalledWith({ where: { seriesId: 's1', id: { not: 'e1' }, date: { gte: '2026-09-14' } }, data: { totalSpots: 8 } })
      expect(h.recompute).toHaveBeenCalledWith('e2', 8, p)   // batch 42: under the occurrence's lock
    })
  })
})

// ── e ──────────────────────────────────────────────────────────────────────
describe('e. restore brings seats back up to the cap', () => {
  const stamp = new Date('2026-09-10T12:00:00Z')
  const rows = [{ id: 'a1', userId: 'u1' }, { id: 'a2', userId: 'co1' }, { id: 'a3', userId: 'u3' }, { id: 'a4', userId: 'u4' }, { id: 'a5', userId: 'u5' }]

  it('pure split: joined order, staff always back and using no room', () => {
    expect(splitRestoredSeats(rows, { totalSpots: 3, approved: 0, staffIds: ['host', 'co1'] }))
      .toEqual({ seated: rows.slice(0, 4), overflow: [rows[4]] })
    expect(splitRestoredSeats(rows, { totalSpots: 3, approved: 5, staffIds: ['co1'] }))
      .toEqual({ seated: [rows[1]], overflow: [rows[0], rows[2], rows[3], rows[4]] })
  })

  it('a limited event whose cap was lowered while cancelled: seats up to it, the rest waitlisted and told', async () => {
    p.eventAttendee.findMany.mockResolvedValue(rows)
    p.event.findUnique.mockResolvedValue({ hostId: 'host', limitedSpots: true, totalSpots: 3, cohosts: [{ userId: 'co1' }] })
    const r = await restoreSeatsReleasedByCancel({ id: 'e1', title: 'Picnic', totalSpots: 3, limitedSpots: true, approvalRequired: false, cancelledAt: stamp })
    expect(r).toEqual({ restored: 4, status: 'approved', waitlisted: 1 })
    expect(p.eventAttendee.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ['a1', 'a2', 'a3', 'a4'] }, status: 'removed' })
    expect(p.waitlistEntry.upsert).toHaveBeenCalledTimes(1)
    expect(p.waitlistEntry.upsert.mock.calls[0][0].create).toEqual({ userId: 'u5', eventId: 'e1' })
    expect(h.recompute).toHaveBeenCalledWith('e1', 3, p)
    const toU5 = h.createNotification.mock.calls.find((c: any) => c[0] === 'u5')
    expect(toU5[3]).toContain("you're on the waitlist")
    lockedBeforeCount()
  })

  it('both restore paths pass limitedSpots', () => {
    const route = read('app/api/admin/events/[id]/route.ts')
    expect(route).toContain('limitedSpots: event.limitedSpots,')
    expect(route).toContain('limitedSpots: before.limitedSpots,')
  })
})

// ── f ──────────────────────────────────────────────────────────────────────
describe('f. co-host changes re-derive spotsLeft', () => {
  it('adding and removing a co-host both recompute the counter', async () => {
    p.event.findUnique.mockResolvedValue({ title: 'Picnic', hostId: 'host', totalSpots: 10 })
    expect((await cohostPOST(req({ userId: 'u5' }), params)).status).toBe(200)
    expect(h.recompute).toHaveBeenCalledWith('e1', 10)
    h.recompute.mockClear()
    expect((await cohostDELETE(req({ userId: 'u5' }), params)).status).toBe(200)
    // batch 42: a removal is capacity-checked, so it re-derives inside the lock
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
  })
})

// ── g ──────────────────────────────────────────────────────────────────────
describe('g. lib/eventCapacity verdicts', () => {
  it('seatVerdict: unlimited always ok; limited ok up to the cap', () => {
    expect(seatVerdict({ limited: false, totalSpots: 1, approved: 50 })).toEqual({ ok: true })
    expect(seatVerdict({ limited: true, totalSpots: 10, approved: 9 })).toEqual({ ok: true })
    expect(seatVerdict({ limited: true, totalSpots: 10, approved: 10 })).toEqual({ ok: false, approved: 10, totalSpots: 10 })
  })
  it('shrinkVerdict: refuses only a tightening under the seats', () => {
    const from = { totalSpots: 10, limited: true }
    expect(shrinkVerdict({ approved: 9, from, to: { totalSpots: 8, limited: true } }).ok).toBe(false)
    expect(shrinkVerdict({ approved: 8, from, to: { totalSpots: 8, limited: true } }).ok).toBe(true)
    expect(shrinkVerdict({ approved: 15, from, to: { totalSpots: 12, limited: true } }).ok).toBe(true)
    expect(shrinkVerdict({ approved: 15, from, to: { totalSpots: 10, limited: true } }).ok).toBe(true)
    expect(shrinkVerdict({ approved: 15, from: { totalSpots: 10, limited: false }, to: { totalSpots: 10, limited: true } }).ok).toBe(false)
    expect(shrinkVerdict({ approved: 15, from, to: { totalSpots: 2, limited: false } }).ok).toBe(true)
  })
  it('wantsOverCapacity: only a literal true', () => {
    expect(wantsOverCapacity({ allowOverCapacity: true })).toBe(true)
    for (const v of ['true', 1, 'yes', null, undefined]) expect(wantsOverCapacity({ allowOverCapacity: v })).toBe(false)
    expect(wantsOverCapacity(null)).toBe(false)
  })
})

// ── h ──────────────────────────────────────────────────────────────────────
describe('h. lib/admin/overCapacity', () => {
  const refused = () => new Response(JSON.stringify({ error: 'full', code: 'over_capacity', approved: 10, totalSpots: 10 }), { status: 409 })
  const other   = () => new Response(JSON.stringify({ error: 'paused', code: 'red_card_blocked' }), { status: 409 })
  const ok      = () => new Response('{}', { status: 200 })

  it('recognises only a capacity refusal, and leaves the body readable', async () => {
    const res = refused()
    expect(await capacityRefusal(res)).toMatchObject({ code: 'over_capacity', approved: 10, totalSpots: 10 })
    expect((await res.json()).error).toBe('full')
    expect(await capacityRefusal(other())).toBeNull()
    expect(await capacityRefusal(ok())).toBeNull()
  })

  it('asks "This will exceed capacity", resends with the override on yes, sends nothing more on no', async () => {
    const send = vi.fn().mockResolvedValueOnce(refused()).mockResolvedValueOnce(ok())
    h.confirmToast.mockResolvedValueOnce(true)
    expect((await withCapacityConfirm(send))!.status).toBe(200)
    expect(send.mock.calls).toEqual([[false], [true]])
    expect(h.confirmToast.mock.calls[0][0]).toContain('This will exceed capacity')

    const send2 = vi.fn().mockResolvedValue(refused())
    h.confirmToast.mockResolvedValueOnce(false)
    expect(await withCapacityConfirm(send2)).toBeNull()
    expect(send2).toHaveBeenCalledTimes(1)
  })

  it('any other refusal comes straight back without a question', async () => {
    const send = vi.fn().mockResolvedValue(other())
    expect((await withCapacityConfirm(send))!.status).toBe(409)
    expect(h.confirmToast).not.toHaveBeenCalled()
  })

  it('a batch asks once: yes overrides the rest, no leaves the rest refused', async () => {
    const yes = capacityConfirmForBatch()
    h.confirmToast.mockResolvedValueOnce(true)
    const send = vi.fn(async (allow: boolean) => allow ? ok() : refused())
    for (let i = 0; i < 3; i++) expect((await yes(send)).status).toBe(200)
    expect(send.mock.calls).toEqual([[false], [true], [true], [true]])

    const no = capacityConfirmForBatch()
    h.confirmToast.mockResolvedValueOnce(false)
    for (let i = 0; i < 3; i++) expect((await no(send)).status).toBe(409)
    expect(h.confirmToast).toHaveBeenCalledTimes(2)
  })
})

// ── i ──────────────────────────────────────────────────────────────────────
describe('i. staff pages send the override only through the confirm', () => {
  const pages = {
    perEvent: read('app/admin/events/[id]/participants/page.tsx'),
    host:     read('app/host/events/[id]/participants/page.tsx'),
    inbox:    read('app/admin/participants/page.tsx'),
    edit:     read('app/admin/events/[id]/edit/page.tsx'),
    hostEdit: read('app/host/events/[id]/edit/page.tsx'),
  }
  it('every allowOverCapacity in a page rides a withCapacityConfirm / batch-confirm callback', () => {
    for (const [name, src] of Object.entries(pages)) {
      const flags = src.match(/allowOverCapacity: true/g)?.length ?? 0
      const gated = src.match(/(withCapacityConfirm|sendChecked)\(allowOverCapacity =>/g)?.length ?? 0
      expect(flags, name).toBeGreaterThan(0)
      expect(flags, name).toBe(gated)
      expect(src, name).not.toMatch(/[^\w.]confirm\(/)
    }
  })
  it('the seat actions and saves are the ones wired', () => {
    expect(pages.perEvent.match(/withCapacityConfirm\(allowOverCapacity => fetch\(/g)).toHaveLength(3)   // approve, add, promote
    expect(pages.perEvent).toContain('const sendChecked = capacityConfirmForBatch()')                     // approve all / promote N
    expect(pages.host.match(/withCapacityConfirm\(allowOverCapacity => fetch\(/g)).toHaveLength(3)
    expect(pages.inbox.match(/withCapacityConfirm\(allowOverCapacity => fetch\(/g)).toHaveLength(2)
    // The inbox batch spans events: one confirm per event (scan6Batch7).
    expect(pages.inbox).toContain("const patchAction = (action: 'approve' | 'reject', confirms = capacityConfirmPerEvent()) =>")
    expect(pages.edit).toContain('const res = await withCapacityConfirm(allowOverCapacity => fetch(`/app/api/admin/events/${id}`, {')
    expect(pages.hostEdit).toContain('const res = await withCapacityConfirm(allowOverCapacity => fetch(`/app/api/admin/events/${id}`, {')
  })
})

// ── j ──────────────────────────────────────────────────────────────────────
describe('j. postponed events with no new date', () => {
  const at = (iso: string) => new Date(iso)
  const postponeRow = (iso: string) => ({ createdAt: at(iso), meta: { diff: { status: { from: 'published', to: 'postponed' } } } })
  const dateRow = (iso: string, to: string) => ({ createdAt: at(iso), meta: { diff: { date: { from: '2026-09-01', to } } } })

  it('timeline: last postpone from the audit trail; a date set in or after it counts; no audit → updatedAt, marked', () => {
    const fb = at('2026-09-12T00:00:00Z')
    expect(postponedTimeline([postponeRow('2026-09-02T09:00:00Z')], fb)).toEqual({ postponedAt: at('2026-09-02T09:00:00Z'), fromAudit: true, dateChangedSince: false })
    expect(postponedTimeline([dateRow('2026-08-20T00:00:00Z', '2026-09-01'), postponeRow('2026-09-02T09:00:00Z')], fb).dateChangedSince).toBe(false)
    expect(postponedTimeline([postponeRow('2026-09-02T09:00:00Z'), dateRow('2026-09-05T00:00:00Z', '2026-10-01')], fb).dateChangedSince).toBe(true)
    expect(postponedTimeline([{ createdAt: at('2026-09-01T00:00:00Z'), meta: 'junk' }], fb)).toEqual({ postponedAt: fb, fromAudit: false, dateChangedSince: false })
  })

  const facts = (o: Partial<PostponedFacts> = {}): PostponedFacts => ({
    id: 'p1', title: 'Hike', emoji: '🥾', date: '2026-09-01', cityId: 'c1', city: 'Istanbul', cityToday: '2026-09-14', hostId: 'host',
    seats: 2, pending: 1, waitlist: 0, paymentsPending: 1, paymentsPendingTotal: 300, paymentsPaid: 1, currency: 'TRY',
    updatedAt: at('2026-09-13T00:00:00Z'), audit: [postponeRow('2026-09-02T09:00:00Z')], ...o,
  })
  const now = at('2026-09-14T10:00:00Z')

  it('plan: ≥7 days with someone waiting → host due; under 7 days, a real new date, or nobody waiting → not', () => {
    expect(planPostponed([facts()], now)[0]).toMatchObject({ daysSincePostponed: 12, needsNewDate: true, remindHost: true })
    expect(planPostponed([facts({ audit: [postponeRow('2026-09-10T09:00:00Z')] })], now)[0].remindHost).toBe(false)
    const dated = facts({ date: '2026-10-01', audit: [postponeRow('2026-09-02T09:00:00Z'), dateRow('2026-09-03T00:00:00Z', '2026-10-01')] })
    expect(planPostponed([dated], now)[0]).toMatchObject({ needsNewDate: false, remindHost: false })
    // the new date has itself passed: back to needing one
    expect(planPostponed([{ ...dated, date: '2026-09-10', cityToday: '2026-09-14' }], now)[0].needsNewDate).toBe(true)
    expect(planPostponed([facts({ seats: 0, pending: 0, waitlist: 0 })], now)[0]).toMatchObject({ needsNewDate: true, remindHost: false })
  })

  describe('loader and host reminder', () => {
    const row = { id: 'p1', title: 'Hike', emoji: '🥾', date: '2026-09-01', cityId: 'c1', hostId: 'host', updatedAt: at('2026-09-13T00:00:00Z'), currency: 'TRY', city: { name: 'Istanbul' }, cohosts: [{ userId: 'co1' }] }
    beforeEach(() => {
      p.event.findMany.mockImplementation(async ({ where }: any) => where.status === 'postponed' ? [row] : [])
      p.eventAttendee.findMany.mockResolvedValue([
        { eventId: 'p1', userId: 'u1', status: 'approved' }, { eventId: 'p1', userId: 'u2', status: 'approved' },
        { eventId: 'p1', userId: 'co1', status: 'approved' }, { eventId: 'p1', userId: 'u3', status: 'pending' },
      ])
      p.payment.findMany.mockResolvedValue([{ eventId: 'p1', status: 'pending', amount: 300 }, { eventId: 'p1', status: 'paid', amount: 300 }])
      p.auditLog.findMany.mockResolvedValue([{ targetId: 'p1', ...postponeRow('2026-09-02T09:00:00Z') }])
    })

    it('loads seats without staff, pending, payments; scoped to a city when asked', async () => {
      const [f] = await loadPostponedEvents({ cityId: 'c1' })
      expect(f).toMatchObject({ seats: 2, pending: 1, waitlist: 0, paymentsPending: 1, paymentsPendingTotal: 300, paymentsPaid: 1, cityToday: '2026-09-14' })
      expect(p.event.findMany.mock.calls[0][0].where).toEqual({ status: 'postponed', cityId: 'c1' })
      expect(p.auditLog.findMany.mock.calls[0][0].where).toMatchObject({ targetType: 'event', action: 'event.update' })
    })

    it('one reminder to the host under a 14-day claim, linking to the edit page', async () => {
      expect(await remindHostsOfPostponedEvents(now)).toEqual({ checked: 1, reminded: 1 })
      expect(h.claimOnce).toHaveBeenCalledWith(postponedReminderKey('p1'), 14 * DAY)
      expect(postponedReminderKey('p1')).toBe('postponed-host-reminder:p1')
      const [to, type, , body, link] = h.createNotification.mock.calls[0]
      expect([to, type, link]).toEqual(['host', 'system_alert', '/host/events/p1/edit'])
      expect(body).toContain('postponed for 12 days with 2 members still holding a spot, 1 request waiting')
    })

    it('a held claim sends nothing; a failed write hands the claim back', async () => {
      h.claimOnce.mockResolvedValueOnce(false)
      expect((await remindHostsOfPostponedEvents(now)).reminded).toBe(0)
      expect(h.createNotification).not.toHaveBeenCalled()
      h.createNotification.mockResolvedValueOnce(false)
      expect((await remindHostsOfPostponedEvents(now)).reminded).toBe(0)
      expect(h.releaseClaim).toHaveBeenCalledWith('postponed-host-reminder:p1')
    })

    it('the daily waitlist sweep runs it — and keeps a postponed event\'s queue', async () => {
      p.waitlistEntry.findMany.mockImplementation(async ({ where }: any = {}) => where?.eventId ? [] : [{ id: 'w1', userId: 'u1', eventId: 'p1' }])
      const body = await (await waitlistSweepPOST(cronReq())).json()
      expect(body).toMatchObject({ ok: true, deleted: 0, postponed: { checked: 1, reminded: 1 } })
      const pastQuery = p.event.findMany.mock.calls.find((c: any) => c[0].where.id)[0].where
      expect(pastQuery.status).toEqual({ not: 'postponed' })
      expect(p.waitlistEntry.deleteMany).not.toHaveBeenCalled()
    })
  })

  it('the dashboard shows them: stats field and pill', () => {
    const stats = read('app/api/admin/stats/route.ts')
    expect(stats).toContain('loadPostponedEvents({ cityId })')
    expect(stats).toContain('postponedNoDate: postponed.map(r => ({')
    expect(stats).not.toContain("from '@/lib/postponedReminder'")   // the loader stays free of the notify/push stack
    const page = read('app/admin/page.tsx')
    expect(page).toContain('stats.postponedNoDate && stats.postponedNoDate.length > 0 && {')
    expect(page).toContain('`/admin/events/${stats.postponedNoDate[0].id}/edit`')
  })
})

// ── k ──────────────────────────────────────────────────────────────────────
describe('k. the automated sweeps leave postponed events alone', () => {
  it('payment sweep: reminders only on published events, and pass 3 never closes a postponed seat\'s payment', async () => {
    await paymentSweepPOST(cronReq())
    const upcoming = p.event.findMany.mock.calls[0][0].where
    expect(upcoming.status).toBe('published')
    const stale = p.payment.findMany.mock.calls.find((c: any) => c[0].where.OR)[0].where
    expect(stale.OR.every((arm: any) => arm.event.status.not === 'postponed')).toBe(true)
  })

  it('reconfirmation asks only published events', () => {
    const e = { price: 0, memberPrice: null, payTo: 'venue', ticketUrl: null, paymentContact: null, limitedSpots: true, status: 'published', cancelledAt: null, approvalRequired: false, time: '19:00' }
    expect(needsReconfirmation(e)).toBe(true)
    expect(needsReconfirmation({ ...e, status: 'postponed' })).toBe(false)
  })

  it('no-show settling, surveys, reminders, auto-archive and the first-RSVP nudge only read published/archived', () => {
    const noShow = read('lib/noShow.ts')
    expect(noShow).toContain("if (event.cancelledAt || !['published', 'archived'].includes(event.status)) return")
    expect(noShow).toContain("status: { in: ['published', 'archived'] },")
    expect(read('app/api/cron/sweep-event-surveys/route.ts').match(/status: +\{ in: \['published', 'archived'\] \},/g)).toHaveLength(2)
    const reminders = read('app/api/admin/cron/reminders/route.ts')
    expect(reminders).toContain("where: { OR: before(todayGroups), status: 'published' },")
    expect(reminders).toContain("where: { OR: onDay(todayOrTomorrow), status: 'published' },")
    expect(read('lib/firstRsvpNudge.ts')).toContain("where: { status: 'published', date:")
    for (const f of ['lib/noShow.ts', 'lib/reconfirm.ts', 'app/api/cron/sweep-event-surveys/route.ts', 'app/api/admin/cron/reminders/route.ts']) {
      expect(read(f), f).not.toContain("'postponed'")
    }
  })
})

// ── l ──────────────────────────────────────────────────────────────────────
describe('l. scripts', () => {
  const cap = (o: Partial<CapacityFacts>): CapacityFacts => ({
    eventId: 'e1', title: 'Picnic', date: '2026-09-20', status: 'published', cancelled: false, city: 'Istanbul', cityToday: '2026-09-14',
    limitedSpots: true, totalSpots: 10, spotsLeft: 0, approved: 10, ...o,
  })

  it('audit-overcapacity-events: only limited events over the cap; recompute only a wrong counter; upcoming first', () => {
    const { rows, counts } = planOvercapacity([
      cap({ eventId: 'full' }),
      cap({ eventId: 'unlimited', limitedSpots: false, approved: 30 }),
      cap({ eventId: 'past', date: '2026-08-01', approved: 12 }),
      cap({ eventId: 'stale', approved: 13, spotsLeft: 2 }),
    ])
    expect(rows.map(r => r.eventId)).toEqual(['stale', 'past'])
    expect(rows[0]).toMatchObject({ over: 3, upcoming: true, correctSpotsLeft: 0, action: 'recompute_spots_left' })
    expect(rows[1]).toMatchObject({ over: 2, upcoming: false, action: 'none' })
    expect(counts).toEqual({ events: 2, upcoming: 1, seatsOver: 5, toRecompute: 1 })
  })

  it('audit-overcapacity-events APPLY only re-derives spotsLeft, guarded; nothing unseats', () => {
    const src = read('scripts/audit-overcapacity-events.ts')
    expect(src).toContain("const APPLY_MODE = process.env.APPLY === '1'")
    expect(src).toContain('where: { id: r.eventId, spotsLeft: r.spotsLeft, totalSpots: r.totalSpots, limitedSpots: true },')
    expect(src).not.toMatch(/eventAttendee\.(update|updateMany|delete|deleteMany)\(/)
  })

  it('audit-postponed-events is read-only and totals what waits on events with no date', () => {
    const now = new Date('2026-09-14T10:00:00Z')
    const base: PostponedFacts = {
      id: 'p1', title: 'Hike', emoji: '🥾', date: '2026-09-01', cityId: 'c1', city: 'Istanbul', cityToday: '2026-09-14', hostId: 'host',
      seats: 20, pending: 1, waitlist: 3, paymentsPending: 4, paymentsPendingTotal: 1200, paymentsPaid: 2, currency: 'TRY',
      updatedAt: new Date('2026-09-05T00:00:00Z'), audit: [],
    }
    const rows = planPostponed([base, { ...base, id: 'p2', seats: 0, pending: 0, waitlist: 0, paymentsPending: 0, paymentsPendingTotal: 0, paymentsPaid: 0 }], now)
    expect(summarizePostponed(rows)).toEqual({
      events: 2, needsNewDate: 2, seatsOnNoDate: 20, pendingOnNoDate: 1, waitlistOnNoDate: 3,
      paymentsPending: 4, pendingByCurrency: { TRY: 1200 }, paymentsPaid: 2, hostReminderDue: 1, daysFromUpdatedAt: 2,
    })
    expect(describePostponed(rows[0])).toContain('(from updatedAt — no audit row, lower bound)')
    const src = read('scripts/audit-postponed-events.ts')
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/)
    expect(src).not.toContain('createNotification')
  })
})
