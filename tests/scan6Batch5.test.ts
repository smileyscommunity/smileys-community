import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Scan 6, batch 5 — a host/staff removal after the doors open promoted the
// first waitlister (seat, payment row, "A spot opened up — you're in!"), who
// then couldn't make it and was carded as a no-show by settleEvent. The
// member's own cancel already held back by an eventHasStarted rule private to
// the rsvp route; that rule now lives in lib/eventTime and both paths read it.
//
//   a. participants DELETE after start: removed, recounted in the lock, nobody promoted or told
//   b. participants DELETE before start: promotes exactly as before
//   c. the start is read on the event city's clock
//   d. TBA counts as not started until its day ends
//   e. a legacy '19.30' time reads as 19:30, as on the event page
//   f. rsvp route: join gate and cancel announcement unchanged

const h = vi.hoisted(() => {
  const prisma = {
    $transaction:  vi.fn(),
    $queryRaw:     vi.fn(),
    event:         { findUnique: vi.fn() },
    eventAttendee: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    eventCoHost:   { findFirst: vi.fn() },
    waitlistEntry: { findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    payment:       { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    paymentLog:    { create: vi.fn(), createMany: vi.fn() },
    user:          { findUnique: vi.fn(), findMany: vi.fn() },
  }
  return {
    prisma,
    getSession:         vi.fn(),
    createNotification: vi.fn(),
    findPromotable:     vi.fn(),
    recompute:          vi.fn(),
    createSeatPayment:  vi.fn(),
    announceSpotOpened: vi.fn(),
    city: { getCityTz: vi.fn(), todayInCity: vi.fn() },
  }
})

vi.mock('@/lib/prisma',         () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',        () => ({ getSession: h.getSession }))
vi.mock('@/lib/rateLimit',      () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/notify',         () => ({ createNotification: h.createNotification }))
vi.mock('@/lib/city',           () => h.city)
vi.mock('@/lib/access',         () => ({ isAdmin: vi.fn(), isClubHost: vi.fn(), canManageEventOps: vi.fn(async () => true) }))
vi.mock('@/lib/email',          () => ({ sendEventApprovedEmail: vi.fn(async () => {}), sendEventRejectedEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/audit',          () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/autoJoinClub',   () => ({ autoJoinClub: vi.fn(async () => {}) }))
vi.mock('@/lib/firstEvent',     () => ({ stampFirstEventRsvp: vi.fn(async () => {}) }))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/spotsLeft',      () => ({ recomputeSpotsLeft: h.recompute }))
vi.mock('@/lib/spotOpened',     () => ({ announceSpotOpened: h.announceSpotOpened }))
vi.mock('@/lib/rsvpConfirmed',  () => ({ createSeatPayment: h.createSeatPayment, announceConfirmedSeat: vi.fn(async () => {}) }))
vi.mock('@/lib/eventQuota',     () => ({ findPromotableFromWaitlist: h.findPromotable, hasQuotaRoomFor: vi.fn(async () => ({ ok: true })), quotaEventSelect: { totalSpots: true } }))
vi.mock('@/lib/noShow', () => ({
  getRsvpGate: vi.fn(async () => ({ ok: true })), gateErrorBody: vi.fn(),
  checkRsvpAllowed: vi.fn(async () => ({ ok: true })), recordYellowAcknowledgement: vi.fn(),
}))

import { DELETE as participantsDELETE } from '@/app/api/admin/events/[id]/participants/route'
import { POST as rsvpPOST, DELETE as rsvpDELETE } from '@/app/api/events/[id]/rsvp/route'
import { eventHasStarted } from '@/lib/eventTime'

const p = h.prisma as any
const params = { params: Promise.resolve({ id: 'e1' }) } as any
const req = (body: unknown = {}) => ({ json: async () => body }) as any

// Free 19:00–23:00 event in Istanbul (UTC+3 all year): doors at 16:00Z.
const ev = {
  id: 'e1', title: 'Picnic', status: 'published', cancelledAt: null, registrationDeadline: null,
  cityId: 'c1', date: '2026-09-20', time: '19:00', endTime: '23:00',
  hostId: 'host', cohosts: [], limitedSpots: true, totalSpots: 10, approvalRequired: false,
  price: 0, payTo: 'venue', currency: 'TRY',
}
const at = (iso: string) => vi.setSystemTime(new Date(iso))
const BEFORE_START = '2026-09-20T15:00:00Z'   // 18:00 Istanbul
const MID_EVENT    = '2026-09-20T17:30:00Z'   // 20:30 Istanbul

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  at(BEFORE_START)
  p.$transaction.mockImplementation(async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(p))
  p.$queryRaw.mockResolvedValue([])
  p.event.findUnique.mockResolvedValue(ev)
  p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved', checkedIn: false })
  p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
  p.eventAttendee.create.mockResolvedValue({})
  p.eventAttendee.count.mockResolvedValue(5)
  p.eventCoHost.findFirst.mockResolvedValue(null)
  p.waitlistEntry.findUnique.mockResolvedValue(null)
  p.waitlistEntry.delete.mockResolvedValue({})
  p.payment.findMany.mockResolvedValue([])
  p.payment.updateMany.mockResolvedValue({ count: 0 })
  p.paymentLog.createMany.mockResolvedValue({ count: 0 })
  p.user.findUnique.mockResolvedValue({ status: 'approved', gender: null, nationality: null })
  p.user.findMany.mockResolvedValue([])
  h.getSession.mockResolvedValue({ id: 'staff', name: 'Staff', role: 'admin', email: 's@x.test' })
  h.createNotification.mockResolvedValue(true)
  h.findPromotable.mockResolvedValue({ id: 'w9', userId: 'u9' })
  h.recompute.mockResolvedValue(undefined)
  h.createSeatPayment.mockResolvedValue(undefined)
  h.announceSpotOpened.mockResolvedValue(0)
  h.city.getCityTz.mockResolvedValue('Europe/Istanbul')
  h.city.todayInCity.mockResolvedValue('2026-09-20')
})
afterEach(() => vi.useRealTimers())

const expectNobodyPromoted = () => {
  expect(h.findPromotable).not.toHaveBeenCalled()
  expect(p.waitlistEntry.delete).not.toHaveBeenCalled()
  expect(p.eventAttendee.create).not.toHaveBeenCalled()
  expect(h.createSeatPayment).not.toHaveBeenCalled()
  expect(h.createNotification).not.toHaveBeenCalled()
}
const expectPromotedU9 = () => {
  expect(p.waitlistEntry.delete).toHaveBeenCalledWith({ where: { id: 'w9' } })
  expect(h.createSeatPayment).toHaveBeenCalledWith(p, 'e1', expect.anything(), 'u9')
  expect(h.createNotification).toHaveBeenCalledWith('u9', 'waitlist_promoted', expect.any(String), expect.stringContaining("you're in"), '/events/e1')
}

// ── a ──────────────────────────────────────────────────────────────────────
describe('a. participants DELETE after the event has started', () => {
  it('removes the attendee, re-derives spotsLeft under the lock, promotes and notifies nobody', async () => {
    at(MID_EVENT)
    const res = await participantsDELETE(req({ userId: 'u1' }), params)
    expect(res.status).toBe(200)

    const removal = p.eventAttendee.updateMany.mock.calls.map((c: any) => c[0]).find((u: any) => u.where.userId === 'u1')
    expect(removal.data).toMatchObject({ status: 'removed', cancelledBy: 'admin' })

    expectNobodyPromoted()
    expect(h.city.getCityTz).toHaveBeenCalledWith('c1')
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
    expect(p.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.recompute.mock.invocationCallOrder[0])
  })

  it('holds at the exact start minute, not only after it', async () => {
    at('2026-09-20T16:00:00Z')
    await participantsDELETE(req({ userId: 'u1' }), params)
    expectNobodyPromoted()
    expect(h.recompute).toHaveBeenCalledTimes(1)
  })
})

// ── b ──────────────────────────────────────────────────────────────────────
describe('b. participants DELETE before the event starts', () => {
  it('promotes the next eligible waitlister with a seat payment and the spot-opened notice, as before', async () => {
    const res = await participantsDELETE(req({ userId: 'u1' }), params)
    expect(res.status).toBe(200)
    expect(h.findPromotable).toHaveBeenCalledWith('e1', expect.objectContaining({ totalSpots: 10 }))
    expectPromotedU9()
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
  })

  it('a pending request removed mid-event still neither promotes nor recounts', async () => {
    at(MID_EVENT)
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    await participantsDELETE(req({ userId: 'u1' }), params)
    expectNobodyPromoted()
    expect(h.recompute).not.toHaveBeenCalled()
  })
})

// ── c ──────────────────────────────────────────────────────────────────────
describe("c. the start is read on the event city's clock", () => {
  it('17:30Z is 18:30 in London — not started there, so the promotion runs', async () => {
    at(MID_EVENT)
    h.city.getCityTz.mockResolvedValue('Europe/London')
    await participantsDELETE(req({ userId: 'u1' }), params)
    expectPromotedU9()
  })
})

// ── d ──────────────────────────────────────────────────────────────────────
describe('d. a TBA event counts as not started until its day ends', () => {
  const tba = { ...ev, time: 'TBA', endTime: null }

  it('helper: late on its own day is not started; past 23:59 city time it is', () => {
    expect(eventHasStarted(tba, 'Europe/Istanbul', Date.parse('2026-09-20T20:58:00Z'))).toBe(false)  // 23:58
    expect(eventHasStarted(tba, 'Europe/Istanbul', Date.parse('2026-09-20T20:59:00Z'))).toBe(true)   // 23:59
  })

  it('route: removal at 22:00 on the day still promotes', async () => {
    at('2026-09-20T19:00:00Z')
    p.event.findUnique.mockResolvedValue(tba)
    await participantsDELETE(req({ userId: 'u1' }), params)
    expectPromotedU9()
  })

  it('route: removal after the day is over promotes nobody', async () => {
    at('2026-09-20T21:30:00Z')   // 00:30 the next day in Istanbul
    p.event.findUnique.mockResolvedValue(tba)
    await participantsDELETE(req({ userId: 'u1' }), params)
    expectNobodyPromoted()
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
  })
})

// ── e ──────────────────────────────────────────────────────────────────────
describe("e. a legacy '19.30' time reads as 19:30", () => {
  const dotted = { ...ev, time: '19.30', endTime: '23.00' }

  it('helper: 19:29 is not started, 19:30 is (it used to read as end of day)', () => {
    expect(eventHasStarted(dotted, 'Europe/Istanbul', Date.parse('2026-09-20T16:29:00Z'))).toBe(false)
    expect(eventHasStarted(dotted, 'Europe/Istanbul', Date.parse('2026-09-20T16:30:00Z'))).toBe(true)
    expect(eventHasStarted(dotted, 'Europe/Istanbul', new Date('2026-09-20T16:30:00Z'))).toBe(true)
  })

  it('route: removal at 19:45 promotes nobody', async () => {
    at('2026-09-20T16:45:00Z')
    p.event.findUnique.mockResolvedValue(dotted)
    await participantsDELETE(req({ userId: 'u1' }), params)
    expectNobodyPromoted()
  })

  it('helper: an unparseable date is never started', () => {
    expect(eventHasStarted({ date: '09/07/2026', time: '19:00' }, 'Europe/Istanbul', Date.parse('2030-01-01T00:00:00Z'))).toBe(false)
  })
})

// ── f ──────────────────────────────────────────────────────────────────────
describe('f. rsvp route on the shared helper: behaviour unchanged', () => {
  const STARTED_ERROR = 'This event has already started — RSVPs and the waitlist are closed'

  it('POST after the start is refused with the started error', async () => {
    at(MID_EVENT)
    h.getSession.mockResolvedValue({ id: 'm1', name: 'Mo', role: 'member' })
    const res = await rsvpPOST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(STARTED_ERROR)
  })

  it('POST before the start passes the gate (the host check right after it answers)', async () => {
    h.getSession.mockResolvedValue({ id: 'host', name: 'Host', role: 'member' })
    const res = await rsvpPOST(req(), params)
    expect((await res.json()).error).toBe('Hosts cannot join their own event')
  })

  it('POST on a TBA event late on its day passes the gate', async () => {
    at('2026-09-20T19:00:00Z')
    p.event.findUnique.mockResolvedValue({ ...ev, time: 'TBA', endTime: null })
    h.getSession.mockResolvedValue({ id: 'host', name: 'Host', role: 'member' })
    const res = await rsvpPOST(req(), params)
    expect((await res.json()).error).toBe('Hosts cannot join their own event')
  })

  it('DELETE of an approved seat before the start announces the spot', async () => {
    h.getSession.mockResolvedValue({ id: 'm1', name: 'Mo', role: 'member', email: 'mo@x.test' })
    const res = await rsvpDELETE(req(), params)
    expect(res.status).toBe(200)
    expect(h.announceSpotOpened).toHaveBeenCalledWith('e1', ['m1'])   // the canceller names the seat
    expect(h.recompute).not.toHaveBeenCalled()
  })

  it('DELETE of an approved seat after the start only recounts', async () => {
    at(MID_EVENT)
    h.getSession.mockResolvedValue({ id: 'm1', name: 'Mo', role: 'member', email: 'mo@x.test' })
    const res = await rsvpDELETE(req(), params)
    expect(res.status).toBe(200)
    expect(h.announceSpotOpened).not.toHaveBeenCalled()
    expect(h.recompute).toHaveBeenCalledWith('e1', 10)
  })
})
