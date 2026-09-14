import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fifth scan, batch 33 — approved seats with no live payment. The production
// audit found 59 on Smileys-collected events, rows auto-cancelled by the
// payment sweep, 4 of them checked in.
//   a. createSeatPayment is idempotent: one live row per seat, none for staff
//   b. every host/admin seat path writes the row: approve, add, promote, and
//      the promotion that follows a removal
//   c. the member's request path goes through the same helper
//   d. collection switched on after people joined, and a restored event,
//      backfill upcoming seats
//   e. the sweep never touches a seat, backfills + reminds a seat with no
//      row, holds a checked-in attendee's row open, still closes unpaid ones
//   f. scripts/audit-seats-without-payment.ts planning

const h = vi.hoisted(() => {
  const prisma = {
    $transaction:  vi.fn(),
    $queryRaw:     vi.fn(),
    event:         { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    eventAttendee: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    eventCoHost:   { findFirst: vi.fn(), findMany: vi.fn() },
    waitlistEntry: { findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(), create: vi.fn(), count: vi.fn() },
    payment:       { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    paymentLog:    { create: vi.fn(), createMany: vi.fn() },
    user:          { findUnique: vi.fn(), findMany: vi.fn() },
    city:          { findMany: vi.fn(), findUnique: vi.fn() },
    auditLog:      { findMany: vi.fn() },
    tagGroup:      { findMany: vi.fn() },
  }
  return {
    prisma,
    getSession:         vi.fn(),
    createNotification: vi.fn(),
    city: { citiesByToday: vi.fn(), todayInCity: vi.fn(), getCityTz: vi.fn(), resolveCityId: vi.fn() },
  }
})

vi.mock('@/lib/prisma',         () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',        () => ({ getSession: h.getSession }))
vi.mock('@/lib/rateLimit',      () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true) }))
vi.mock('@/lib/notify',         () => ({ createNotification: h.createNotification, notifyNewEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/city',           () => h.city)
vi.mock('@/lib/cronHealth',     () => ({ recordCronRun: vi.fn() }))
vi.mock('@/lib/access', () => ({
  isAdmin:            (s: any) => s?.role === 'admin',
  isModerator:        (s: any) => s?.role === 'moderator',
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
  isClubHost:         vi.fn(async () => false),
  isClubHostFor:      vi.fn(async () => false),
  hostCityIds:        vi.fn(async () => []),
  canManageEventOps:  vi.fn(async () => true),
}))
vi.mock('@/lib/email', () => ({
  sendEventApprovedEmail:    vi.fn(async () => {}),
  sendEventRejectedEmail:    vi.fn(async () => {}),
  sendRsvpConfirmationEmail: vi.fn(async () => {}),
  sendEventCancelledEmail:   vi.fn(async () => {}),
  recordEmailFailure:        vi.fn(async () => {}),
}))
vi.mock('@/lib/audit',          () => ({ writeAudit: vi.fn(), getDiff: vi.fn(() => null) }))
vi.mock('@/lib/autoJoinClub',   () => ({ autoJoinClub: vi.fn(async () => {}) }))
vi.mock('@/lib/spotsLeft',      () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/spotOpened',     () => ({ announceSpotOpened: vi.fn(async () => 0) }))
vi.mock('@/lib/firstEvent',     () => ({ stampFirstEventRsvp: vi.fn(async () => {}) }))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/eventQuota', () => ({
  findPromotableFromWaitlist: vi.fn(), hasQuotaRoomFor: vi.fn(async () => ({ ok: true })), quotaEventSelect: {},
}))
vi.mock('@/lib/noShow', () => ({
  getRsvpGate: vi.fn(async () => ({ ok: true })), gateErrorBody: vi.fn(), waiveCard: vi.fn(),
  checkRsvpAllowed: vi.fn(async () => ({ ok: true })), recordYellowAcknowledgement: vi.fn(),
}))

import { createSeatPayment, backfillSeatPayments } from '@/lib/rsvpConfirmed'
import { DELETE as participantsDELETE, PATCH as participantsPATCH, POST as participantsPOST, PUT as participantsPUT } from '@/app/api/admin/events/[id]/participants/route'
import { POST as rsvpPOST } from '@/app/api/events/[id]/rsvp/route'
import { PUT as eventPUT } from '@/app/api/admin/events/[id]/route'
import { POST as sweepPOST } from '@/app/api/cron/sweep-payment-reminders/route'
import { restoreSeatsReleasedByCancel } from '@/lib/eventRestore'
import { planSeatPayments, bucketFor, type SeatFacts } from '@/scripts/audit-seats-without-payment'
import { findPromotableFromWaitlist } from '@/lib/eventQuota'

const p = h.prisma as any
const params = { params: Promise.resolve({ id: 'e1' }) } as any
const req = (body: unknown) => ({ json: async () => body }) as any
const cronReq = () => new Request('http://x/api', { headers: { 'x-cron-secret': 'sek', authorization: 'Bearer sek' } }) as any

// An in-memory ledger behind the payment mocks, so "created once" is a claim
// about rows, not about how many times a mock was called.
type Row = { id: string; userId: string; eventId: string; status: string; amount?: number; currency?: string; reminderSentAt?: Date | null }
let ledger: Row[] = []
const oneOf = (v: string, f: any) => f === undefined || (typeof f === 'string' ? v === f : f.in.includes(v))
const matches = (r: Row, w: any = {}) =>
  (w.id === undefined || r.id === w.id) && oneOf(r.eventId, w.eventId) && oneOf(r.userId, w.userId) && oneOf(r.status, w.status) &&
  (w.reminderSentAt === undefined || (r.reminderSentAt ?? null) === w.reminderSentAt)
const live = (eventId = 'e1') => ledger.filter(r => r.eventId === eventId && ['pending', 'paid'].includes(r.status))
let staleRows: (Row & { event: { title: string } })[] = []

const collectEvent = {
  id: 'e1', title: 'Wine Night', hostId: 'host', cityId: 'c1', status: 'published', cancelledAt: null,
  date: '2026-09-20', time: '19:00', endTime: null, registrationDeadline: null, totalSpots: 20, spotsLeft: 5, limitedSpots: false,
  approvalRequired: false, price: 400, memberPrice: null, currency: 'TRY', payTo: 'smileys', soldOut: false, genderBalance: false,
  location: 'Karaköy', neighborhood: null, maleQuota: null, femaleQuota: null, turkishMaleQuota: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'sek'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
  ledger = []
  staleRows = []
  let n = 0
  p.$transaction.mockImplementation(async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(p))
  p.$queryRaw.mockResolvedValue([])
  p.payment.findFirst.mockImplementation(async ({ where }: any) => ledger.find(r => matches(r, where)) ?? null)
  p.payment.findMany.mockImplementation(async ({ where }: any) =>
    where.OR ? staleRows.filter(r => r.status === where.status) : ledger.filter(r => matches(r, where)))
  p.payment.create.mockImplementation(async ({ data }: any) => { const row = { id: `pay${++n}`, ...data }; ledger.push(row); return row })
  p.payment.update.mockImplementation(async ({ where, data }: any) => Object.assign(ledger.find(r => r.id === where.id)!, data))
  p.payment.updateMany.mockImplementation(async ({ where, data }: any) => {
    const rows = [...ledger, ...staleRows].filter(r => matches(r, where))
    rows.forEach(r => Object.assign(r, data))
    return { count: rows.length }
  })
  p.eventCoHost.findFirst.mockImplementation(async ({ where }: any) => where.userId === 'co1' ? { id: 'ch1' } : null)
  p.eventCoHost.findMany.mockResolvedValue([{ userId: 'co1' }])
  p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
  p.eventAttendee.create.mockResolvedValue({})
  p.eventAttendee.update.mockResolvedValue({})
  p.eventAttendee.findFirst.mockResolvedValue({ id: 'seat' })
  p.waitlistEntry.delete.mockResolvedValue({})
  p.waitlistEntry.deleteMany.mockResolvedValue({ count: 1 })
  p.user.findUnique.mockResolvedValue({ name: 'Uma', email: 'u@x', gender: 'female', nationality: 'Germany', status: 'approved' })
  p.user.findMany.mockResolvedValue([])
  p.city.findUnique.mockResolvedValue({ name: 'Istanbul' })
  h.createNotification.mockResolvedValue(true)
  h.city.todayInCity.mockResolvedValue('2026-09-14')
  h.city.getCityTz.mockResolvedValue('Europe/Istanbul')
})
afterEach(() => vi.useRealTimers())

// ── a ──────────────────────────────────────────────────────────────────────
describe('a. createSeatPayment: one live row per seat, none for staff', () => {
  it('writes a pending row once, under a per-seat lock; the second call is a no-op', async () => {
    expect(await createSeatPayment(p, 'e1', collectEvent, 'u1')).toBe(true)
    expect(await createSeatPayment(p, 'e1', collectEvent, 'u1')).toBe(false)
    expect(live()).toEqual([{ id: 'pay1', userId: 'u1', eventId: 'e1', amount: 400, currency: 'TRY', status: 'pending' }])
    expect(String(p.$queryRaw.mock.calls[0][0].join('?'))).toContain('pg_advisory_xact_lock(hashtext(?), hashtext(?))')
  })
  it('a member whose earlier row is still paid is not charged again', async () => {
    ledger.push({ id: 'old', userId: 'u1', eventId: 'e1', status: 'paid' })
    expect(await createSeatPayment(p, 'e1', collectEvent, 'u1')).toBe(false)
    expect(p.payment.create).not.toHaveBeenCalled()
  })
  it('a cancelled row does not count as live — the seat gets a new one', async () => {
    ledger.push({ id: 'old', userId: 'u1', eventId: 'e1', status: 'cancelled' })
    expect(await createSeatPayment(p, 'e1', collectEvent, 'u1')).toBe(true)
    expect(live().map(r => r.userId)).toEqual(['u1'])
  })
  it('host and co-hosts owe nothing', async () => {
    expect(await createSeatPayment(p, 'e1', collectEvent, 'host')).toBe(false)
    expect(await createSeatPayment(p, 'e1', collectEvent, 'co1')).toBe(false)
    expect(p.payment.create).not.toHaveBeenCalled()
  })
  it('free and venue-paid events touch nothing at all', async () => {
    expect(await createSeatPayment(p, 'e1', { ...collectEvent, price: 0 }, 'u1')).toBe(false)
    expect(await createSeatPayment(p, 'e1', { ...collectEvent, payTo: 'venue' }, 'u1')).toBe(false)
    expect(p.$queryRaw).not.toHaveBeenCalled()
    expect(p.payment.findFirst).not.toHaveBeenCalled()
  })
})

// ── b ──────────────────────────────────────────────────────────────────────
describe('b. host/admin seat paths write the ledger row', () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue({ id: 'staff1', name: 'Host', role: 'host' })
    p.event.findUnique.mockResolvedValue(collectEvent)
  })

  it('approve a pending request whose row is gone → one pending row; approving again adds none', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    expect((await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)).status).toBe(200)
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    expect((await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)).status).toBe(200)
    expect(live()).toEqual([expect.objectContaining({ userId: 'u1', status: 'pending', amount: 400 })])
  })
  it('approve keeps the row written at request time instead of adding a second', async () => {
    ledger.push({ id: 'req', userId: 'u1', eventId: 'e1', status: 'pending' })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(p.payment.create).not.toHaveBeenCalled()
    expect(live().map(r => r.id)).toEqual(['req'])
  })
  it('a quota-full approve seats nobody and writes no row', async () => {
    p.event.findUnique.mockResolvedValue({ ...collectEvent, genderBalance: true, femaleQuota: 1 })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    p.eventAttendee.count.mockResolvedValue(1)
    const res = await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect((await res.json()).status).toBe('waitlisted')
    expect(p.payment.create).not.toHaveBeenCalled()
  })
  it('manual add (PUT) → one pending row', async () => {
    p.eventAttendee.findUnique.mockResolvedValue(null)
    expect((await participantsPUT(req({ userId: 'u1' }), params)).status).toBe(200)
    expect(live()).toEqual([expect.objectContaining({ userId: 'u1', status: 'pending' })])
  })
  it('waitlist promote (POST) → one pending row', async () => {
    p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
    p.eventAttendee.findUnique.mockResolvedValue(null)
    expect((await participantsPOST(req({ userId: 'u1' }), params)).status).toBe(200)
    expect(live()).toEqual([expect.objectContaining({ userId: 'u1', status: 'pending' })])
  })
  it('removing a seat promotes the next in line with a row; the removed pending row is voided', async () => {
    ledger.push({ id: 'gone', userId: 'u1', eventId: 'e1', status: 'pending' })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    ;(findPromotableFromWaitlist as any).mockResolvedValue({ id: 'w2', userId: 'u2' })
    expect((await participantsDELETE(req({ userId: 'u1' }), params)).status).toBe(200)
    expect(live()).toEqual([expect.objectContaining({ userId: 'u2', status: 'pending' })])
  })
  it('a free event: the same paths write nothing', async () => {
    p.event.findUnique.mockResolvedValue({ ...collectEvent, price: 0 })
    p.eventAttendee.findUnique.mockResolvedValue(null)
    await participantsPUT(req({ userId: 'u1' }), params)
    expect(p.payment.create).not.toHaveBeenCalled()
  })
})

// ── c ──────────────────────────────────────────────────────────────────────
describe("c. the member's request path uses the same helper", () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue({ id: 'u1', name: 'Uma', email: 'u@x', role: 'member' })
    p.event.findUnique.mockResolvedValue({ ...collectEvent, approvalRequired: true })
    p.eventAttendee.findUnique.mockResolvedValue(null)
    p.waitlistEntry.findUnique.mockResolvedValue(null)
  })
  it('a request writes one pending row with the attendee', async () => {
    const res = await rsvpPOST(req({}), params)
    expect((await res.json()).status).toBe('pending')
    expect(live()).toEqual([{ id: 'pay1', userId: 'u1', eventId: 'e1', amount: 400, currency: 'TRY', status: 'pending' }])
  })
  it('re-requesting while an earlier row is still paid writes no second', async () => {
    ledger.push({ id: 'old', userId: 'u1', eventId: 'e1', status: 'paid' })
    await rsvpPOST(req({}), params)
    expect(p.payment.create).not.toHaveBeenCalled()
  })
})

// ── d ──────────────────────────────────────────────────────────────────────
describe('d. collection switched on after people joined, and restored events', () => {
  const seats = [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'co1' }, { userId: 'host' }]
  beforeEach(() => {
    p.eventAttendee.findMany.mockResolvedValue(seats)
  })

  it('backfill: every approved non-staff seat without a live row, once; a re-run writes nothing', async () => {
    p.event.findUnique.mockResolvedValue(collectEvent)
    ledger.push({ id: 'had', userId: 'u2', eventId: 'e1', status: 'pending' })
    expect(await backfillSeatPayments('e1')).toBe(1)
    expect(await backfillSeatPayments('e1')).toBe(0)
    expect(live().map(r => r.userId).sort()).toEqual(['u1', 'u2'])
  })
  it('backfill skips a seat given back since the list was read', async () => {
    p.event.findUnique.mockResolvedValue(collectEvent)
    p.eventAttendee.findFirst.mockResolvedValue(null)
    expect(await backfillSeatPayments('e1')).toBe(0)
  })
  it('backfill never bills a past event', async () => {
    p.event.findUnique.mockResolvedValue({ ...collectEvent, date: '2026-09-10' })
    expect(await backfillSeatPayments('e1')).toBe(0)
    expect(p.eventAttendee.findMany).not.toHaveBeenCalled()
  })

  it('admin PUT turning on Smileys collection backfills the seats already taken', async () => {
    h.getSession.mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin', cityId: 'c1' })
    let current: any = { ...collectEvent, price: 0, payTo: 'venue', clubId: null, seriesId: null, emoji: '🍷', isPremium: false, membersOnly: false, isFirstTimerFriendly: false }
    p.event.findUnique.mockImplementation(async () => current)
    p.event.update.mockImplementation(async ({ data }: any) => (current = { ...current, ...data }))
    const res = await eventPUT(req({ price: 400, payTo: 'smileys' }), params)
    expect(res.status).toBe(200)
    expect(live().map(r => r.userId).sort()).toEqual(['u1', 'u2'])
  })
  it('admin PUT that leaves pricing alone writes no rows', async () => {
    h.getSession.mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin', cityId: 'c1' })
    let current: any = { ...collectEvent, clubId: null, seriesId: null, emoji: '🍷', isPremium: false, membersOnly: false, isFirstTimerFriendly: false }
    p.event.findUnique.mockImplementation(async () => current)
    p.event.update.mockImplementation(async ({ data }: any) => (current = { ...current, ...data }))
    expect((await eventPUT(req({ title: 'Wine Night II' }), params)).status).toBe(200)
    expect(p.payment.create).not.toHaveBeenCalled()
  })

  it('a restored event brings its approved seats back with rows', async () => {
    const stamp = new Date('2026-09-13T12:00:00Z')
    p.eventAttendee.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'removed' ? [{ id: 'a1', userId: 'u1' }] : [{ userId: 'u1' }])
    p.event.findUnique.mockResolvedValue(collectEvent)
    const r = await restoreSeatsReleasedByCancel({ id: 'e1', title: 'Wine Night', totalSpots: 20, approvalRequired: false, cancelledAt: stamp })
    expect(r).toEqual({ restored: 1, status: 'approved' })
    expect(live()).toEqual([expect.objectContaining({ userId: 'u1', status: 'pending' })])
  })
})

// ── e ──────────────────────────────────────────────────────────────────────
describe('e. the payment sweep', () => {
  const dates: Record<number, string> = { 0: '2026-09-14', 2: '2026-09-16', [-3]: '2026-09-11' }
  const attendeeWrites = () => [p.eventAttendee.update, p.eventAttendee.updateMany, p.eventAttendee.create]
  let attended: { userId: string; eventId: string }[] = []

  beforeEach(() => {
    attended = []
    h.city.citiesByToday.mockImplementation(async (off = 0) => [{ date: dates[off], cityIds: ['c1'] }])
    p.event.findMany.mockResolvedValue([])
    p.event.findUnique.mockResolvedValue({ ...collectEvent, date: '2026-09-15' })
    p.eventAttendee.findMany.mockImplementation(async ({ where }: any) =>
      where.OR ? attended : [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'host' }, { userId: 'co1' }])
  })

  it('a seat with no row gets a pending row and one reminder; staff get neither; no seat is touched', async () => {
    p.event.findMany.mockResolvedValue([{ id: 'e1', title: 'Wine Night', hostId: 'host' }])
    ledger.push({ id: 'had', userId: 'u2', eventId: 'e1', status: 'pending', reminderSentAt: new Date() })
    const res = await sweepPOST(cronReq())
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, backfilled: 1, reminded: 1, autoCancelled: 0 })
    expect(live().map(r => r.userId).sort()).toEqual(['u1', 'u2'])
    expect(h.createNotification).toHaveBeenCalledTimes(1)
    expect(h.createNotification.mock.calls[0].slice(0, 2)).toEqual(['u1', 'payment_reminder'])
    for (const f of attendeeWrites()) expect(f).not.toHaveBeenCalled()
  })

  it('pass 3: checked-in and attended rows are held open; the unpaid no-show row is closed with its log', async () => {
    const stale = (id: string, userId: string) => ({ id, userId, eventId: 'e0', status: 'pending', event: { title: 'Past' } })
    staleRows = [stale('p1', 'u1'), stale('p2', 'u2'), stale('p3', 'u3')]
    attended = [{ userId: 'u1', eventId: 'e0' }, { userId: 'u2', eventId: 'e0' }]
    const body = await (await sweepPOST(cronReq())).json()
    expect(body).toMatchObject({ autoCancelled: 1, heldCheckedIn: 2 })
    expect(staleRows.map(r => [r.id, r.status])).toEqual([['p1', 'pending'], ['p2', 'pending'], ['p3', 'cancelled']])
    expect(p.paymentLog.create).toHaveBeenCalledTimes(1)
    expect(p.paymentLog.create.mock.calls[0][0].data).toMatchObject({ paymentId: 'p3', adminId: 'system', toStatus: 'cancelled' })
    // the attended lookup asks about check-in and settled attendance both
    const q = p.eventAttendee.findMany.mock.calls.find((c: any) => c[0].where.OR)[0].where
    expect(q.OR).toEqual([{ checkedIn: true }, { attendance: 'attended' }])
    for (const f of attendeeWrites()) expect(f).not.toHaveBeenCalled()
  })

  it('pass 3 closes only a row still pending: one marked paid meanwhile stays paid, no log', async () => {
    staleRows = [{ id: 'p9', userId: 'u9', eventId: 'e0', status: 'pending', event: { title: 'Past' } }]
    p.payment.updateMany.mockImplementationOnce(async ({ where }: any) => {
      expect(where).toEqual({ id: 'p9', status: 'pending' })
      return { count: 0 }
    })
    const body = await (await sweepPOST(cronReq())).json()
    expect(body.autoCancelled).toBe(0)
    expect(p.paymentLog.create).not.toHaveBeenCalled()
  })
})

// ── f ──────────────────────────────────────────────────────────────────────
describe('f. scripts/audit-seats-without-payment planning', () => {
  const seat = (o: Partial<SeatFacts>): SeatFacts => ({
    seatId: 's', userId: 'u', userInitial: 'U', checkedIn: false, attendance: 'unknown', isStaff: false,
    eventId: 'e1', eventTitle: 'T', eventDate: '2026-09-20', eventStatus: 'published', eventCancelled: false,
    city: 'Istanbul', cityToday: '2026-09-14', payments: [], ...o,
  })

  it('buckets by what happened to the ledger', () => {
    expect(bucketFor([])).toBe('no_row_ever')
    expect(bucketFor([{ status: 'cancelled', sweepCancelled: false }])).toBe('row_cancelled_seat_kept')
    expect(bucketFor([{ status: 'cancelled', sweepCancelled: false }, { status: 'cancelled', sweepCancelled: true }])).toBe('sweep_cancelled')
    expect(bucketFor([{ status: 'refunded', sweepCancelled: false }])).toBe('refunded')
    expect(bucketFor([{ status: 'failed', sweepCancelled: false }])).toBe('other')
  })

  it('creates rows only for upcoming published seats that owe nothing; the rest are listed', () => {
    const { rows, counts } = planSeatPayments([
      seat({ seatId: 's1' }),                                                                        // upcoming, no row → create
      seat({ seatId: 's2', payments: [{ status: 'cancelled', sweepCancelled: false }] }),           // upcoming, voided row → create
      seat({ seatId: 's3', eventDate: '2026-09-01', checkedIn: true, payments: [{ status: 'cancelled', sweepCancelled: true }] }), // past, swept, came
      seat({ seatId: 's4', eventDate: '2026-09-02' }),                                              // past, no row
      seat({ seatId: 's5', payments: [{ status: 'cancelled', sweepCancelled: true }] }),            // upcoming but swept → list
      seat({ seatId: 's6', payments: [{ status: 'refunded', sweepCancelled: false }] }),            // refunded → list
      seat({ seatId: 's7', eventStatus: 'postponed' }),                                              // not published → list
      seat({ seatId: 's8', eventCancelled: true }),                                                  // cancelled → list
      seat({ seatId: 's9', payments: [{ status: 'paid', sweepCancelled: false }] }),                // live → skipped
      seat({ seatId: 's10', isStaff: true }),                                                        // staff → skipped
      seat({ seatId: 's11', eventDate: '2026-09-14' }),                                             // today counts as upcoming
    ])
    const act = Object.fromEntries(rows.map(r => [r.seatId, r.action]))
    expect(act).toEqual({
      s1: 'create_pending', s2: 'create_pending', s3: 'list_only', s4: 'list_only', s5: 'list_only',
      s6: 'list_only', s7: 'list_only', s8: 'list_only', s11: 'create_pending',
    })
    expect(rows.map(r => r.seatId).slice(0, 3)).toEqual(['s3', 's4', 's11'])   // sorted by date
    expect(counts).toMatchObject({
      listed: 9, toCreate: 3, pastEvents: 2, checkedIn: 1, sweepCancelled: 2, skippedLive: 1, skippedStaff: 1,
      byBucket: { sweep_cancelled: 2, row_cancelled_seat_kept: 1, refunded: 1, no_row_ever: 5, other: 0 },
    })
    expect(rows.find(r => r.seatId === 's3')!.why).toBe('past event — product decision')
  })
})
