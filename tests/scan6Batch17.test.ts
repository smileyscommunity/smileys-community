import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Scan 6, batch 17 — low-severity ledger and seat fixes.
//
//   20. restoring a cancelled event whose cap was lowered sends the overflow
//       to the waitlist; their pending payments are closed in the same
//       transaction (sweep log shape), paid ones untouched and reported
//   22. re-approving an attendee who is already approved is a no-op, not a
//       409 over_capacity — before the lock and under it (double-click)
//   26. the payment sweep holds a checked-in attendee's pending row ONCE:
//       marked in notes + logged, out of pass 3 from then on; the payments
//       admin counts them
//   +   rejecting an approved attendee recounts spotsLeft under the lock

const h = vi.hoisted(() => {
  const prisma = {
    $transaction:  vi.fn(),
    $queryRaw:     vi.fn(),
    event:         { findUnique: vi.fn(), findMany: vi.fn() },
    eventAttendee: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    eventCoHost:   { findMany: vi.fn() },
    waitlistEntry: { upsert: vi.fn() },
    payment:       { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    paymentLog:    { create: vi.fn(), createMany: vi.fn() },
    user:          { findUnique: vi.fn() },
  }
  return {
    prisma,
    getSession:         vi.fn(),
    createNotification: vi.fn(),
    recompute:          vi.fn(),
    writeAudit:         vi.fn(),
    createSeatPayment:  vi.fn(),
    city: { citiesByToday: vi.fn(), getCityTz: vi.fn(), resolveCityId: vi.fn(async () => 'c-ist') },
  }
})

vi.mock('@/lib/prisma',       () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',      () => ({ getSession: h.getSession }))
vi.mock('@/lib/rateLimit',    () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/notify',       () => ({ createNotification: h.createNotification }))
vi.mock('@/lib/city',         () => h.city)
vi.mock('@/lib/cronHealth',   () => ({ recordCronRun: vi.fn() }))
vi.mock('@/lib/stepUp',       () => ({ requireStepUp: vi.fn(() => null) }))
vi.mock('@/lib/access', () => ({
  isAdmin:           (s: any) => s?.role === 'admin',
  isClubHost:        vi.fn(async () => false),
  canManageEventOps: vi.fn(async () => true),
  canManagePayments: (s: any) => s?.role === 'admin',
}))
vi.mock('@/lib/email', () => ({
  sendEventApprovedEmail: vi.fn(async () => {}),
  sendEventRejectedEmail: vi.fn(async () => {}),
  sendRefundEmail:        vi.fn(async () => {}),
  recordEmailFailure:     vi.fn(async () => {}),
}))
vi.mock('@/lib/audit',        () => ({ writeAudit: h.writeAudit }))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn(async () => {}) }))
vi.mock('@/lib/spotsLeft',    () => ({ recomputeSpotsLeft: h.recompute }))
vi.mock('@/lib/rsvpConfirmed', () => ({ createSeatPayment: h.createSeatPayment, backfillSeatPayments: vi.fn(async () => 0) }))
vi.mock('@/lib/eventQuota', () => ({
  findPromotableFromWaitlist: vi.fn(async () => null), hasQuotaRoomFor: vi.fn(async () => ({ ok: true })), quotaEventSelect: {},
}))
vi.mock('@/lib/noShow', () => ({ getRsvpGate: vi.fn(async () => ({ ok: true })), gateErrorBody: vi.fn() }))

import { restoreSeatsReleasedByCancel } from '@/lib/eventRestore'
import { PATCH as participantsPATCH } from '@/app/api/admin/events/[id]/participants/route'
import { POST as sweepPOST } from '@/app/api/cron/sweep-payment-reminders/route'
import { GET as paymentsGET } from '@/app/api/admin/payments/route'
import { PAYMENT_HELD_CHECKED_IN } from '@/lib/constants'
import { NextRequest } from 'next/server'

const p = h.prisma as any
const params = { params: Promise.resolve({ id: 'e1' }) } as any
const req = (body: unknown) => ({ json: async () => body }) as any
const cronReq = () => new Request('http://x/api', { headers: { 'x-cron-secret': 'sek', authorization: 'Bearer sek' } }) as any
const order = (f: any) => f.mock.invocationCallOrder[0]

// In-memory payment ledger: status + notes guards are honoured, so "marked
// once" and "paid untouched" are claims about rows.
type Pay = { id: string; userId: string; eventId: string; status: string; amount: number; currency: string; notes: string | null; event?: { title: string } }
let ledger: Pay[] = []
const inOrEq = (v: string, f: any) => f === undefined || (typeof f === 'string' ? v === f : f.in.includes(v))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'sek'
  ledger = []
  p.$transaction.mockImplementation(async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(p))
  p.$queryRaw.mockResolvedValue([])
  p.payment.findMany.mockImplementation(async ({ where }: any) => ledger.filter(r =>
    inOrEq(r.status, where.status) && inOrEq(r.eventId, where.eventId) && inOrEq(r.userId, where.userId) &&
    // pass 3's "not already held" arm
    (!where.AND || !(r.notes ?? '').includes(PAYMENT_HELD_CHECKED_IN))))
  p.payment.updateMany.mockImplementation(async ({ where, data }: any) => {
    const rows = ledger.filter(r => r.id === where.id && inOrEq(r.status, where.status) &&
      (!('notes' in where) || (r.notes ?? null) === where.notes))
    rows.forEach(r => Object.assign(r, data))
    return { count: rows.length }
  })
  p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
  p.eventAttendee.update.mockResolvedValue({})
  p.eventCoHost.findMany.mockResolvedValue([])
  p.waitlistEntry.upsert.mockResolvedValue({})
  p.user.findUnique.mockResolvedValue({ name: 'Uma', email: 'u@x', gender: null, nationality: null })
  h.recompute.mockResolvedValue(undefined)
  h.createNotification.mockResolvedValue(true)
  h.createSeatPayment.mockResolvedValue(true)
  h.city.getCityTz.mockResolvedValue('Europe/Istanbul')
})
afterEach(() => vi.restoreAllMocks())

// ── 20 ─────────────────────────────────────────────────────────────────────
describe('20. restore overflow: pending payments of the waitlisted are closed, paid ones reported', () => {
  const stamp = new Date('2026-09-13T12:00:00Z')
  const ev = { id: 'e1', title: 'Picnic', totalSpots: 1, limitedSpots: true, approvalRequired: false, cancelledAt: stamp }
  const pay = (id: string, userId: string, status: string): Pay => ({ id, userId, eventId: 'e1', status, amount: 400, currency: 'TRY', notes: null })

  beforeEach(() => {
    p.eventAttendee.findMany.mockResolvedValue([{ id: 'a1', userId: 'u1' }, { id: 'a2', userId: 'u2' }, { id: 'a3', userId: 'u3' }])
    p.event.findUnique.mockResolvedValue({ hostId: 'host', limitedSpots: true, totalSpots: 1, cohosts: [] })
    p.eventAttendee.count.mockResolvedValue(0)
  })

  it('u1 seated keeps its pending row; u2 (pending) cancelled with a system log; u3 (paid) untouched and listed', async () => {
    ledger = [pay('pay1', 'u1', 'pending'), pay('pay2', 'u2', 'pending'), pay('pay3', 'u3', 'paid')]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const r = await restoreSeatsReleasedByCancel(ev)

    expect(r).toEqual({
      restored: 1, status: 'approved', waitlisted: 2,
      paidOnWaitlist: [{ paymentId: 'pay3', userId: 'u3', amount: 400, currency: 'TRY' }],
    })
    expect(ledger.map(x => [x.id, x.status])).toEqual([['pay1', 'pending'], ['pay2', 'cancelled'], ['pay3', 'paid']])
    // only the overflow members' payments were looked at
    expect(p.payment.findMany.mock.calls[0][0].where.userId).toEqual({ in: ['u2', 'u3'] })
    expect(p.payment.updateMany).toHaveBeenCalledTimes(1)
    expect(p.payment.updateMany.mock.calls[0][0].where).toEqual({ id: 'pay2', status: 'pending' })
    expect(p.payment.update).not.toHaveBeenCalled()
    expect(p.paymentLog.create).toHaveBeenCalledTimes(1)
    expect(p.paymentLog.create.mock.calls[0][0].data).toMatchObject({
      paymentId: 'pay2', adminId: 'system', fromStatus: 'pending', toStatus: 'cancelled',
    })
    // inside the restore's locked transaction
    expect(p.$transaction).toHaveBeenCalledTimes(1)
    expect(order(p.$queryRaw)).toBeLessThan(order(p.payment.updateMany))
    expect(order(p.payment.updateMany)).toBeLessThan(order(h.recompute))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[eventRestore]'), expect.objectContaining({ eventId: 'e1' }))
  })

  it('a row marked paid between the read and the write is not cancelled and gets no log', async () => {
    ledger = [pay('pay2', 'u2', 'pending')]
    const readBefore = { ...ledger[0] }
    p.payment.findMany.mockImplementationOnce(async () => [readBefore])
    ledger[0].status = 'paid'
    await restoreSeatsReleasedByCancel(ev)
    expect(ledger[0].status).toBe('paid')
    expect(p.paymentLog.create).not.toHaveBeenCalled()
  })

  it('nobody overflows: no payment is read or written, result shape unchanged', async () => {
    p.event.findUnique.mockResolvedValue({ hostId: 'host', limitedSpots: true, totalSpots: 5, cohosts: [] })
    ledger = [pay('pay1', 'u1', 'pending')]
    expect(await restoreSeatsReleasedByCancel({ ...ev, totalSpots: 5 })).toEqual({ restored: 3, status: 'approved' })
    expect(p.payment.findMany).not.toHaveBeenCalled()
    expect(p.payment.updateMany).not.toHaveBeenCalled()
  })
})

// ── 22 ─────────────────────────────────────────────────────────────────────
describe('22. re-approving an approved attendee on a full event', () => {
  const fullEvent = {
    title: 'Picnic', status: 'published', spotsLeft: 0, date: '2026-09-20', neighborhood: null, totalSpots: 2,
    turkishMaleQuota: null, genderBalance: false, maleQuota: null, femaleQuota: null, approvalRequired: true,
    price: 0, payTo: 'venue', currency: 'TRY', hostId: 'host', limitedSpots: true, cohosts: [],
  }
  beforeEach(() => {
    h.getSession.mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin' })
    p.event.findUnique.mockResolvedValue(fullEvent)
    p.eventAttendee.count.mockResolvedValue(2)
  })
  const noWrites = () => {
    for (const f of [p.eventAttendee.update, p.eventAttendee.updateMany, p.waitlistEntry.upsert, p.payment.updateMany, p.paymentLog.create, h.recompute, h.createSeatPayment]) {
      expect(f).not.toHaveBeenCalled()
    }
    expect(h.createNotification).not.toHaveBeenCalled()
    expect(h.writeAudit).not.toHaveBeenCalled()
  }

  it('stale tab: already approved → 200 {ok:true}, no lock, no count, no writes', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    const res = await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(p.$transaction).not.toHaveBeenCalled()
    expect(p.eventAttendee.count).not.toHaveBeenCalled()
    noWrites()
  })

  it('double-click: read pending, approved by the first click under the lock → 200, nothing counted twice', async () => {
    p.eventAttendee.findUnique
      .mockResolvedValueOnce({ status: 'pending' })   // before the lock
      .mockResolvedValueOnce({ status: 'approved' })  // under it
    const res = await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(p.eventAttendee.count).not.toHaveBeenCalled()
    noWrites()
  })

  it('a pending request on the same full event is still refused (other transitions unchanged)', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    const res = await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(res.status).toBe(409)
    expect(p.eventAttendee.update).not.toHaveBeenCalled()
  })
})

// ── 22+ ────────────────────────────────────────────────────────────────────
describe('reject of an approved attendee recounts spotsLeft under the lock', () => {
  it('lock → soft-remove → recount with the locked cap; payment audit still runs', async () => {
    h.getSession.mockResolvedValue({ id: 'h1', name: 'Host', role: 'host' })
    p.event.findUnique.mockResolvedValue({ title: 'Picnic', status: 'published', totalSpots: 10, hostId: 'host', limitedSpots: true, cohosts: [] })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    const res = await participantsPATCH(req({ userId: 'u1', action: 'reject' }), params)
    expect(res.status).toBe(200)
    expect(h.recompute).toHaveBeenCalledWith('e1', 10, p)
    expect(p.eventAttendee.updateMany.mock.calls[0][0].where).toEqual({ userId: 'u1', eventId: 'e1', status: { in: ['approved', 'pending'] } })
    expect(order(p.$queryRaw)).toBeLessThan(order(p.eventAttendee.updateMany))
    expect(order(p.eventAttendee.updateMany)).toBeLessThan(order(h.recompute))
    expect(h.writeAudit.mock.calls[0][2]).toBe('attendee.reject')
  })
})

// ── 26 ─────────────────────────────────────────────────────────────────────
describe('26. pass 3 holds a checked-in attendee\'s pending row once', () => {
  const dates: Record<number, string> = { 0: '2026-09-14', 2: '2026-09-16', [-3]: '2026-09-11' }
  const stale = (id: string, userId: string, notes: string | null = null): Pay =>
    ({ id, userId, eventId: 'e0', status: 'pending', amount: 400, currency: 'TRY', notes, event: { title: 'Past' } })

  beforeEach(() => {
    h.city.citiesByToday.mockImplementation(async (off = 0) => [{ date: dates[off], cityIds: ['c1'] }])
    p.event.findMany.mockResolvedValue([])
    p.eventAttendee.findMany.mockResolvedValue([{ userId: 'u1', eventId: 'e0' }, { userId: 'u2', eventId: 'e0' }])
  })

  it('first run marks + logs the held rows and closes the no-show; the next run reads none of them and logs nothing', async () => {
    ledger = [stale('p1', 'u1'), stale('p2', 'u2', 'paid cash?'), stale('p3', 'u3')]
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const first = await (await sweepPOST(cronReq())).json()
    expect(first).toMatchObject({ ok: true, heldCheckedIn: 2, autoCancelled: 1 })
    expect(ledger.map(r => [r.id, r.status, r.notes])).toEqual([
      ['p1', 'pending', PAYMENT_HELD_CHECKED_IN],
      ['p2', 'pending', `${PAYMENT_HELD_CHECKED_IN} · paid cash?`],   // the admin's note kept
      ['p3', 'cancelled', null],
    ])
    const logs = p.paymentLog.create.mock.calls.map((c: any) => c[0].data)
    expect(logs).toEqual([
      expect.objectContaining({ paymentId: 'p1', adminId: 'system', fromStatus: null, toStatus: null }),
      expect.objectContaining({ paymentId: 'p2', adminId: 'system', fromStatus: null, toStatus: null }),
      expect.objectContaining({ paymentId: 'p3', adminId: 'system', fromStatus: 'pending', toStatus: 'cancelled' }),
    ])
    expect(log.mock.calls.some(c => String(c[0]).includes('held 2'))).toBe(true)
    // the query itself excludes held rows, NULL notes included explicitly
    const where = p.payment.findMany.mock.calls.at(-1)[0].where
    expect(where.AND).toEqual([{ OR: [{ notes: null }, { NOT: { notes: { contains: PAYMENT_HELD_CHECKED_IN } } }] }])

    vi.clearAllMocks()
    const second = await (await sweepPOST(cronReq())).json()
    expect(second).toMatchObject({ ok: true, heldCheckedIn: 0, autoCancelled: 0 })
    expect(p.eventAttendee.findMany).not.toHaveBeenCalled()   // nothing stale left to look up
    expect(p.payment.updateMany).not.toHaveBeenCalled()
    expect(p.paymentLog.create).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('an admin edit or paid mark between read and write wins: no mark, no log', async () => {
    ledger = [stale('p1', 'u1')]
    const readBefore = { ...ledger[0] }
    p.payment.findMany.mockImplementationOnce(async () => [readBefore])
    ledger[0].notes = 'admin wrote this'
    const body = await (await sweepPOST(cronReq())).json()
    expect(body.heldCheckedIn).toBe(0)
    expect(ledger[0].notes).toBe('admin wrote this')
    expect(p.paymentLog.create).not.toHaveBeenCalled()
  })

  it('the payments admin counts held rows separately (still pending)', async () => {
    h.getSession.mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin' })
    p.payment.findMany.mockResolvedValue([])
    p.payment.groupBy.mockResolvedValue([])
    p.payment.count.mockImplementation(async (arg?: any) =>
      !arg ? 10 : arg.where.notes ? 2 : 5)
    h.city.getCityTz.mockResolvedValue('Europe/Istanbul')
    const body = await (await paymentsGET(new NextRequest('https://x/app/api/admin/payments'))).json()
    expect(body.stats).toMatchObject({ pendingCount: 5, heldCount: 2 })
    expect(p.payment.count).toHaveBeenCalledWith({ where: { status: 'pending', notes: { contains: PAYMENT_HELD_CHECKED_IN } } })
  })
})
