import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fifth scan, batch 14 — the door and the seat around an event's start:
//   54. check-in opens 12 hours before the start, not days before
//   56. no joins or waitlist claims once the event has started, and a
//       mid-event cancel doesn't fan "spot opened" out to the waitlist
//   57. a checked-in attendee is never a no-show, and can't cancel
//   58. one push per waitlister per opened spot, not two
//   59. the approval request cap applies only to limited events, staff excluded
//
// lib/notify is deliberately NOT mocked: item 58 is about how many pushes
// actually leave, and that is decided inside createNotification.

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue(true), claimOnce: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/access',    () => ({ isAdmin: vi.fn(() => false), canManageEventOps: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/push',      () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',     () => ({ sendRsvpConfirmationEmail: vi.fn().mockResolvedValue(undefined), sendSpotOpenedEmail: vi.fn().mockResolvedValue(undefined), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/spotOpened', () => ({ announceSpotOpened: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/autoJoinClub',   () => ({ autoJoinClub: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/firstEvent',     () => ({ stampFirstEventRsvp: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/eventQuota',     () => ({ hasQuotaRoomFor: vi.fn().mockResolvedValue({ ok: true }), quotaEventSelect: {} }))
vi.mock('@/lib/noShow', () => ({ checkRsvpAllowed: vi.fn().mockResolvedValue({ ok: true }), getRsvpGate: vi.fn().mockResolvedValue({ ok: true }), gateErrorBody: vi.fn(), recordYellowAcknowledgement: vi.fn() }))
vi.mock('@/lib/city', () => ({ todayInCity: vi.fn().mockResolvedValue('2026-09-12'), getCityTz: vi.fn().mockResolvedValue('Europe/Istanbul') }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:           vi.fn(),
  $queryRaw:              vi.fn().mockResolvedValue([]),
  city:                   { findUnique: vi.fn().mockResolvedValue({ name: 'Istanbul' }) },
  event:                  { findUnique: vi.fn(), updateMany: vi.fn() },
  user:                   { findUnique: vi.fn(), findMany: vi.fn() },
  eventAttendee:          { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  eventCoHost:            { findFirst: vi.fn(), findMany: vi.fn() },
  waitlistEntry:          { findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(), create: vi.fn(), count: vi.fn() },
  payment:                { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  paymentLog:             { createMany: vi.fn() },
  notification:           { create: vi.fn(), findFirst: vi.fn() },
  notificationPreference: { findUnique: vi.fn() },
} }))

import { POST, DELETE } from '@/app/api/events/[id]/rsvp/route'
import { PATCH as checkinPatch } from '@/app/api/events/[id]/checkin/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getCityTz } from '@/lib/city'
import { sendPushToUser } from '@/lib/push'
import { announceSpotOpened } from '@/lib/spotOpened'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { claimOnce } from '@/lib/rateLimit'
import { isNoShow, NO_SHOW_CANCELLATION_CUTOFF_HOURS } from '@/lib/noShowPolicy'

const p = prisma as any
const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any = {}) => ({ json: async () => body }) as any
const at = (iso: string) => vi.setSystemTime(new Date(iso))
const flush = () => new Promise(r => setTimeout(r, 0))

// 19:00–21:00 Istanbul on 12 Sep = 16:00–18:00 UTC.
const EVENT = {
  id: 'e1', title: 'Picnic', emoji: '🧺', hostId: 'h1', cityId: 'c1', status: 'published', cancelledAt: null,
  noShowProcessedAt: null, date: '2026-09-12', time: '19:00', endTime: '21:00', registrationDeadline: null,
  totalSpots: 20, spotsLeft: 5, limitedSpots: true, approvalRequired: false, price: 0, memberPrice: null,
  payTo: null, soldOut: false, genderBalance: false, maleQuota: null, femaleQuota: null, turkishMaleQuota: null,
}

afterEach(() => vi.useRealTimers())

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-12T09:00:00Z')
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'Una', email: 'u@x', role: 'member' })
  ;(getCityTz as any).mockResolvedValue('Europe/Istanbul')
  p.$transaction.mockImplementation(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(p))
  p.event.findUnique.mockResolvedValue(EVENT)
  p.event.updateMany.mockResolvedValue({ count: 1 })
  p.user.findUnique.mockResolvedValue({ status: 'approved', gender: 'female', nationality: 'Germany', email: 'u@x', name: 'Una' })
  p.user.findMany.mockResolvedValue([])
  p.eventAttendee.findUnique.mockResolvedValue(null)
  p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
  p.eventAttendee.create.mockResolvedValue({})
  p.eventAttendee.count.mockResolvedValue(0)
  p.eventAttendee.findMany.mockResolvedValue([])
  p.eventCoHost.findFirst.mockResolvedValue(null)
  p.eventCoHost.findMany.mockResolvedValue([])
  p.waitlistEntry.findUnique.mockResolvedValue(null)
  p.waitlistEntry.findMany.mockResolvedValue([])
  p.waitlistEntry.create.mockResolvedValue({})
  p.waitlistEntry.count.mockResolvedValue(1)
  p.payment.findMany.mockResolvedValue([])
  p.payment.updateMany.mockResolvedValue({ count: 0 })
  p.notification.create.mockResolvedValue({})
  p.notification.findFirst.mockResolvedValue(null)
  p.notificationPreference.findUnique.mockResolvedValue(null)
})

// ── 54 ───────────────────────────────────────────────────────────────────────

describe('54. check-in opens 12 hours before the start', () => {
  beforeEach(() => {
    ;(getSession as any).mockResolvedValue({ id: 'h1', name: 'Host', email: 'h@x', role: 'host' })
    p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
    p.eventAttendee.findUnique.mockResolvedValue({ id: 'a1', checkedIn: true })
  })

  it('checking in days early → 409 checkin_not_open, and nothing is written', async () => {
    at('2026-09-10T16:00:00Z')
    const res = await checkinPatch(req({ userId: 'u1', checkedIn: true }), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('checkin_not_open')
    expect(body.error).toMatch(/12 hours before/)
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })

  it('one minute before the window is still refused; at the window it checks in', async () => {
    at('2026-09-12T03:59:00Z')   // 06:59 Istanbul, start 19:00
    expect((await checkinPatch(req({ userId: 'u1', checkedIn: true }), params)).status).toBe(409)

    at('2026-09-12T04:00:00Z')   // 07:00 Istanbul — exactly 12h before
    const res = await checkinPatch(req({ userId: 'u1', checkedIn: true }), params)
    expect(res.status).toBe(200)
    expect(p.eventAttendee.updateMany.mock.calls[0][0].data).toEqual({ checkedIn: true, attendance: 'attended' })
  })

  it('reads the start on the event city clock', async () => {
    ;(getCityTz as any).mockResolvedValue('Asia/Tbilisi')   // 19:00 Tbilisi = 15:00Z → opens 03:00Z
    at('2026-09-12T03:30:00Z')                               // would still be closed on Istanbul's clock
    expect((await checkinPatch(req({ userId: 'u1', checkedIn: true }), params)).status).toBe(200)
    expect(getCityTz).toHaveBeenCalledWith('c1')
  })

  it('a TBA time opens at noon the day before', async () => {
    p.event.findUnique.mockResolvedValue({ ...EVENT, time: 'TBA' })
    at('2026-09-11T08:59:00Z')   // 11:59 Istanbul on the 11th
    expect((await checkinPatch(req({ userId: 'u1', checkedIn: true }), params)).status).toBe(409)
    at('2026-09-11T09:00:00Z')   // 12:00
    expect((await checkinPatch(req({ userId: 'u1', checkedIn: true }), params)).status).toBe(200)
  })

  it('un-checking early is a correction and stays allowed', async () => {
    at('2026-09-09T12:00:00Z')
    const res = await checkinPatch(req({ userId: 'u1', checkedIn: false }), params)
    expect(res.status).toBe(200)
    expect(p.eventAttendee.updateMany.mock.calls[0][0].data).toEqual({ checkedIn: false, attendance: 'unknown' })
  })

  it('the settled rule still wins before the window is consulted', async () => {
    p.event.findUnique.mockResolvedValue({ ...EVENT, noShowProcessedAt: new Date() })
    at('2026-09-10T00:00:00Z')
    const res = await checkinPatch(req({ userId: 'u1', checkedIn: true }), params)
    expect((await res.json()).code).toBe('attendance_settled')
  })
})

// ── 56 ───────────────────────────────────────────────────────────────────────

describe('56. no new seats once the event has started', () => {
  function expectNoSeatWritten() {
    expect(p.$transaction).not.toHaveBeenCalled()
    expect(p.eventAttendee.create).not.toHaveBeenCalled()
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    expect(p.event.updateMany).not.toHaveBeenCalled()
    expect(p.waitlistEntry.create).not.toHaveBeenCalled()
    expect(p.waitlistEntry.delete).not.toHaveBeenCalled()
  }

  it('a straight RSVP after the start → 400', async () => {
    at('2026-09-12T16:30:00Z')   // 19:30 Istanbul
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already started/)
    expectNoSeatWritten()
  })

  it('a waitlist claim after the start → 400, the entry stays', async () => {
    at('2026-09-12T16:30:00Z')
    p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expectNoSeatWritten()
  })

  it('an approval request (and its waitlist fallback) after the start → 400', async () => {
    at('2026-09-12T16:30:00Z')
    p.event.findUnique.mockResolvedValue({ ...EVENT, approvalRequired: true, soldOut: true })
    expect((await POST(req(), params)).status).toBe(400)
    expectNoSeatWritten()
  })

  it('a co-host join after the start → 400 too', async () => {
    at('2026-09-12T16:30:00Z')
    p.eventCoHost.findFirst.mockResolvedValue({ id: 'ch1' })
    expect((await POST(req(), params)).status).toBe(400)
    expectNoSeatWritten()
  })

  it('a minute before the start still joins', async () => {
    at('2026-09-12T15:59:00Z')
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('approved')
  })

  it('a TBA event stays joinable all day, and closes when its day ends', async () => {
    p.event.findUnique.mockResolvedValue({ ...EVENT, time: 'TBA', endTime: null })
    at('2026-09-12T20:00:00Z')   // 23:00 Istanbul
    expect((await POST(req(), params)).status).toBe(200)

    vi.clearAllMocks()
    p.$transaction.mockImplementation(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(p))
    at('2026-09-12T21:00:00Z')   // 00:00 on the 13th
    expect((await POST(req(), params)).status).toBe(400)
  })

  describe('cancelling', () => {
    beforeEach(() => {
      p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved', checkedIn: false })
      p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
    })

    it('after the start is still allowed, but announces nothing to the waitlist', async () => {
      at('2026-09-12T16:30:00Z')
      const res = await DELETE(req(), params)
      expect(res.status).toBe(200)
      expect(p.eventAttendee.updateMany.mock.calls.some((c: any) => c[0].data.cancelledBy === 'member')).toBe(true)
      expect(announceSpotOpened).not.toHaveBeenCalled()
      // the "X going" counter is still re-derived
      expect(recomputeSpotsLeft).toHaveBeenCalledWith('e1', 20)
    })

    it('a TBA event mid-day is not "started" — the spot is still announced', async () => {
      p.event.findUnique.mockResolvedValue({ ...EVENT, time: 'TBA', endTime: null })
      at('2026-09-12T12:00:00Z')
      await DELETE(req(), params)
      expect(announceSpotOpened).toHaveBeenCalledWith('e1', ['u1'])   // the canceller names the seat
    })

    it('before the start announces as before', async () => {
      at('2026-09-12T09:00:00Z')
      await DELETE(req(), params)
      expect(announceSpotOpened).toHaveBeenCalledWith('e1', ['u1'])   // the canceller names the seat
      expect(recomputeSpotsLeft).not.toHaveBeenCalled()   // announceSpotOpened owns the recompute
    })
  })
})

// ── 57 ───────────────────────────────────────────────────────────────────────

describe('57. checked in means not a no-show', () => {
  const start = new Date('2026-09-12T16:00:00Z')
  const H = 60 * 60 * 1000

  it('a checked-in row that was later cancelled by the member is not a no-show', () => {
    const lateCancel = new Date(start.getTime() - (NO_SHOW_CANCELLATION_CUTOFF_HOURS - 11) * H)
    expect(isNoShow({ status: 'cancelled', cancelledBy: 'member', cancelledAt: lateCancel, checkedIn: false }, start)).toBe(true)
    expect(isNoShow({ status: 'cancelled', cancelledBy: 'member', cancelledAt: lateCancel, checkedIn: true }, start)).toBe(false)
  })

  it('RSVP DELETE on a checked-in row → 409, nothing cancelled, nothing announced', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved', checkedIn: true })
    const res = await DELETE(req(), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('checked_in')
    expect(body.error).toMatch(/checked in/)
    expect(p.$transaction).not.toHaveBeenCalled()
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    expect(announceSpotOpened).not.toHaveBeenCalled()
  })
})

// ── 58 ───────────────────────────────────────────────────────────────────────

describe('58. one push per waitlister per opened spot', () => {
  it('the only push is the one createNotification sends', async () => {
    const { announceSpotOpened: realAnnounce } = await vi.importActual<typeof import('@/lib/spotOpened')>('@/lib/spotOpened')
    // Batch 32 (item 97) throttles alerts on a per-member claim; this file's
    // mock refuses every claim, so let both waitlisters' first alert through.
    ;(claimOnce as any).mockResolvedValueOnce(true).mockResolvedValueOnce(true)
    p.event.findUnique.mockReset()
      .mockResolvedValueOnce({ title: 'Picnic', date: '2026-09-12', soldOut: false, limitedSpots: true, totalSpots: 20 })
      .mockResolvedValueOnce({ spotsLeft: 1 })
    p.waitlistEntry.findMany.mockResolvedValue([{ userId: 'w1' }, { userId: 'w2' }])
    p.user.findMany.mockResolvedValue([
      { id: 'w1', name: 'A', email: 'a@x', gender: 'female', nationality: null },
      { id: 'w2', name: 'B', email: 'b@x', gender: 'male',   nationality: null },
    ])

    expect(await realAnnounce('e1')).toBe(2)
    await flush(); await flush()

    expect(p.notification.create).toHaveBeenCalledTimes(2)
    expect(sendPushToUser).toHaveBeenCalledTimes(2)
    expect((sendPushToUser as any).mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['w1', 'w2'])
  })
})

// ── 59 ───────────────────────────────────────────────────────────────────────

describe('59. approval request cap: limited events only, staff not counted', () => {
  const approval = { ...EVENT, approvalRequired: true }

  it('an unlimited approval event past its nominal totalSpots still takes a pending request', async () => {
    p.event.findUnique.mockResolvedValue({ ...approval, limitedSpots: false })
    p.eventAttendee.count.mockResolvedValue(25)   // would have been 50 ≥ 20
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('pending')
    expect(p.waitlistEntry.create).not.toHaveBeenCalled()
    expect(p.eventAttendee.count).not.toHaveBeenCalled()
  })

  it('a limited approval event is still capped', async () => {
    p.event.findUnique.mockResolvedValue(approval)
    p.eventAttendee.count.mockResolvedValue(10)   // 10 + 10 ≥ 20
    const res = await POST(req(), params)
    expect((await res.json()).status).toBe('waitlisted')
    expect(p.waitlistEntry.create).toHaveBeenCalled()
    expect(p.eventAttendee.create).not.toHaveBeenCalled()
  })

  it('host and co-hosts are left out of the count', async () => {
    p.event.findUnique.mockResolvedValue(approval)
    p.eventCoHost.findMany.mockResolvedValue([{ userId: 'co1' }, { userId: 'co2' }])
    p.eventAttendee.count.mockImplementation(async ({ where }: any) =>
      // With staff excluded the room holds 9 approved + 10 pending = 19 < 20.
      where.NOT ? (where.status === 'approved' ? 9 : 10) : (where.status === 'approved' ? 12 : 10))
    const res = await POST(req(), params)
    expect((await res.json()).status).toBe('pending')
    for (const [arg] of p.eventAttendee.count.mock.calls) {
      expect(arg.where.NOT).toEqual({ userId: { in: ['h1', 'co1', 'co2'] } })
    }
  })
})
