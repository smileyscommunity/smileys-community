import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Scan 6, batch 16 — lock-order inversion on the seat ledger.
//
// backfillSeatPayments' transaction took the per-seat advisory lock first, and
// its payment insert then needed a FOR KEY SHARE lock on the event row (the
// foreign key). The seat paths take FOR UPDATE on the event row first, then
// wait on the same advisory lock. Same (event, user) at once — a stale-tab
// re-approve while the hourly backfill runs — and Postgres aborts one side
// with 40P01. The sweep didn't catch it, so the whole run failed and later
// events missed their reminders.
//
//   a. backfill: event row lock → advisory lock → insert, in one transaction
//   b. every caller path keeps that order (rsvp join / request / claim,
//      participants approve / add / promote / removal-promote, restore,
//      collection switched on, the audit script's apply)
//   c. the sweep carries on past one event whose backfill throws, and says so

const h = vi.hoisted(() => {
  const order: string[] = []
  const prisma = {
    $transaction:  vi.fn(),
    $queryRaw:     vi.fn(),
    event:         { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
    order,
    prisma,
    getSession:         vi.fn(),
    createNotification: vi.fn(),
    recordCronRun:      vi.fn(),
    city: { citiesByToday: vi.fn(), todayInCity: vi.fn(), getCityTz: vi.fn(), resolveCityId: vi.fn() },
  }
})

vi.mock('@/lib/prisma',         () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',        () => ({ getSession: h.getSession }))
vi.mock('@/lib/rateLimit',      () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true) }))
vi.mock('@/lib/notify',         () => ({ createNotification: h.createNotification, notifyNewEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/city',           () => h.city)
vi.mock('@/lib/cronHealth',     () => ({ recordCronRun: h.recordCronRun }))
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

import { backfillSeatPayments } from '@/lib/rsvpConfirmed'
import { DELETE as participantsDELETE, PATCH as participantsPATCH, POST as participantsPOST, PUT as participantsPUT } from '@/app/api/admin/events/[id]/participants/route'
import { POST as rsvpPOST } from '@/app/api/events/[id]/rsvp/route'
import { PUT as eventPUT } from '@/app/api/admin/events/[id]/route'
import { POST as sweepPOST } from '@/app/api/cron/sweep-payment-reminders/route'
import { restoreSeatsReleasedByCancel } from '@/lib/eventRestore'
import { apply as auditApply } from '@/scripts/audit-seats-without-payment'
import { findPromotableFromWaitlist } from '@/lib/eventQuota'

const p = h.prisma as any
const params = { params: Promise.resolve({ id: 'e1' }) } as any
const req = (body: unknown) => ({ json: async () => body }) as any
const cronReq = () => new Request('http://x/api', { headers: { 'x-cron-secret': 'sek', authorization: 'Bearer sek' } }) as any

type Row = { id: string; userId: string; eventId: string; status: string; reminderSentAt?: Date | null }
let ledger: Row[] = []
const oneOf = (v: string, f: any) => f === undefined || (typeof f === 'string' ? v === f : f.in.includes(v))
const matches = (r: Row, w: any = {}) =>
  (w.id === undefined || r.id === w.id) && oneOf(r.eventId, w.eventId) && oneOf(r.userId, w.userId) && oneOf(r.status, w.status) &&
  (w.reminderSentAt === undefined || (r.reminderSentAt ?? null) === w.reminderSentAt)

const collectEvent = {
  id: 'e1', title: 'Wine Night', hostId: 'host', cityId: 'c1', status: 'published', cancelledAt: null,
  date: '2026-09-20', time: '19:00', endTime: null, registrationDeadline: null, totalSpots: 20, spotsLeft: 5, limitedSpots: false,
  approvalRequired: false, price: 400, memberPrice: null, currency: 'TRY', payTo: 'smileys', soldOut: false, genderBalance: false,
  location: 'Karaköy', neighborhood: null, maleQuota: null, femaleQuota: null, turkishMaleQuota: null,
}

/**
 * Every transaction that took the per-seat advisory lock, as its ordered list
 * of lock/insert steps. Fails if any such step ran outside a transaction.
 */
function seatTransactions(): string[][] {
  const txs: string[][] = []
  let cur: string[] | null = null
  for (const step of h.order) {
    if (step === 'tx:begin') cur = []
    else if (step === 'tx:end') { if (cur?.includes('advisory')) txs.push(cur); cur = null }
    else if (cur) cur.push(step)
    else if (step === 'advisory' || step === 'insert') throw new Error(`${step} outside a transaction`)
  }
  return txs
}
/** At least one seat transaction ran, and each locked the event row before the advisory lock and the insert. */
function expectEventLockFirst() {
  const txs = seatTransactions()
  expect(txs.length).toBeGreaterThan(0)
  for (const tx of txs) {
    const lock = tx.indexOf('event-lock')
    expect(lock, `event row lock missing in [${tx.join(', ')}]`).toBeGreaterThanOrEqual(0)
    expect(lock).toBeLessThan(tx.indexOf('advisory'))
    if (tx.includes('insert')) expect(tx.indexOf('advisory')).toBeLessThan(tx.indexOf('insert'))
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.order.length = 0
  process.env.CRON_SECRET = 'sek'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
  ledger = []
  let n = 0
  p.$transaction.mockImplementation(async (arg: any) => {
    if (Array.isArray(arg)) return Promise.all(arg)
    h.order.push('tx:begin')
    try { return await arg(p) } finally { h.order.push('tx:end') }
  })
  p.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?')
    if (/FROM events WHERE id = \? FOR UPDATE/.test(sql)) h.order.push('event-lock')
    else if (sql.includes('pg_advisory_xact_lock')) h.order.push('advisory')
    return []
  })
  p.payment.findFirst.mockImplementation(async ({ where }: any) => ledger.find(r => matches(r, where)) ?? null)
  p.payment.findMany.mockImplementation(async ({ where }: any) => where.OR ? [] : ledger.filter(r => matches(r, where)))
  p.payment.create.mockImplementation(async ({ data }: any) => {
    h.order.push('insert')
    const row = { id: `pay${++n}`, ...data }; ledger.push(row); return row
  })
  p.payment.update.mockImplementation(async ({ where, data }: any) => Object.assign(ledger.find(r => r.id === where.id)!, data))
  p.payment.updateMany.mockResolvedValue({ count: 0 })
  p.event.findUnique.mockResolvedValue(collectEvent)
  p.event.findFirst.mockResolvedValue(collectEvent)
  p.event.findMany.mockResolvedValue([])
  p.event.updateMany.mockResolvedValue({ count: 1 })
  p.eventCoHost.findFirst.mockImplementation(async ({ where }: any) => where.userId === 'co1' ? { id: 'ch1' } : null)
  p.eventCoHost.findMany.mockResolvedValue([{ userId: 'co1' }])
  p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
  p.eventAttendee.create.mockResolvedValue({})
  p.eventAttendee.update.mockResolvedValue({})
  p.eventAttendee.findFirst.mockResolvedValue({ id: 'seat' })
  p.eventAttendee.findMany.mockResolvedValue([{ userId: 'u1' }])
  p.waitlistEntry.findUnique.mockResolvedValue(null)
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
describe('a. backfillSeatPayments takes the event row lock first', () => {
  it('event lock → seat re-read → advisory lock → insert, all in one transaction', async () => {
    const seatRead = p.eventAttendee.findFirst.getMockImplementation()
    p.eventAttendee.findFirst.mockImplementation(async (...a: any[]) => { h.order.push('seat-read'); return seatRead ? seatRead(...a) : { id: 'seat' } })
    expect(await backfillSeatPayments('e1')).toBe(1)
    expect(h.order).toEqual(['tx:begin', 'event-lock', 'seat-read', 'advisory', 'insert', 'tx:end'])
  })
  it('one transaction per seat, each locking the event row before its advisory lock', async () => {
    p.eventAttendee.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }])
    expect(await backfillSeatPayments('e1')).toBe(3)
    expect(seatTransactions()).toHaveLength(3)
    expectEventLockFirst()
  })
  it('a seat already covered opens no transaction and takes no lock', async () => {
    ledger.push({ id: 'had', userId: 'u1', eventId: 'e1', status: 'pending' })
    expect(await backfillSeatPayments('e1')).toBe(0)
    expect(h.order).toEqual([])
  })
})

// ── b ──────────────────────────────────────────────────────────────────────
describe('b. every caller path: event row lock → advisory lock → insert', () => {
  describe('member rsvp', () => {
    beforeEach(() => {
      h.getSession.mockResolvedValue({ id: 'u1', name: 'Uma', email: 'u@x', role: 'member' })
      p.eventAttendee.findUnique.mockResolvedValue(null)
    })
    it('straight join (auto-approve)', async () => {
      expect((await (await rsvpPOST(req({}), params)).json()).status).toBe('approved')
      expectEventLockFirst()
    })
    it('request on an approval-required event', async () => {
      p.event.findUnique.mockResolvedValue({ ...collectEvent, approvalRequired: true })
      expect((await (await rsvpPOST(req({}), params)).json()).status).toBe('pending')
      expectEventLockFirst()
    })
    it('waitlist claim of an opened spot', async () => {
      p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
      expect((await (await rsvpPOST(req({}), params)).json()).status).toBe('approved')
      expectEventLockFirst()
    })
  })

  describe('host/admin participants', () => {
    beforeEach(() => {
      h.getSession.mockResolvedValue({ id: 'staff1', name: 'Host', role: 'host' })
    })
    it('approve (PATCH), including a stale-tab re-approve of someone already approved', async () => {
      p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
      expect((await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)).status).toBe(200)
      p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
      expect((await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)).status).toBe(200)
      // batch 17: the re-approve of an approved seat returns before any lock or write
      expect(seatTransactions()).toHaveLength(1)
      expectEventLockFirst()
    })
    it('manual add (PUT)', async () => {
      // Seating by hand is an admin's; anyone else sends an invitation.
      h.getSession.mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin', cityId: 'c1' })
      p.user.findUnique.mockResolvedValue({ status: 'approved', suspendedUntil: null, hiddenFromMembers: false, cityId: 'c1' })
      p.eventAttendee.findUnique.mockResolvedValue(null)
      expect((await participantsPUT(req({ userId: 'u1' }), params)).status).toBe(200)
      expectEventLockFirst()
    })
    it('waitlist promote (POST)', async () => {
      p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
      p.eventAttendee.findUnique.mockResolvedValue(null)
      expect((await participantsPOST(req({ userId: 'u1' }), params)).status).toBe(200)
      expectEventLockFirst()
    })
    it('removal that promotes the next in line (DELETE)', async () => {
      p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
      ;(findPromotableFromWaitlist as any).mockResolvedValue({ id: 'w2', userId: 'u2' })
      expect((await participantsDELETE(req({ userId: 'u1' }), params)).status).toBe(200)
      expectEventLockFirst()
    })
  })

  it('restored event → backfill', async () => {
    p.eventAttendee.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'removed' ? [{ id: 'a1', userId: 'u1' }] : [{ userId: 'u1' }])
    const r = await restoreSeatsReleasedByCancel({ id: 'e1', title: 'Wine Night', totalSpots: 20, approvalRequired: false, cancelledAt: new Date('2026-09-13T12:00:00Z') })
    expect(r).toEqual({ restored: 1, status: 'approved' })
    expectEventLockFirst()
  })

  it('admin PUT switching collection on → backfill', async () => {
    h.getSession.mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin', cityId: 'c1' })
    let current: any = { ...collectEvent, price: 0, payTo: 'venue', clubId: null, seriesId: null, emoji: '🍷', isPremium: false, membersOnly: false, isFirstTimerFriendly: false }
    p.event.findUnique.mockImplementation(async () => current)
    p.event.update.mockImplementation(async ({ data }: any) => (current = { ...current, ...data }))
    expect((await eventPUT(req({ price: 400, payTo: 'smileys' }), params)).status).toBe(200)
    expectEventLockFirst()
  })

  it('scripts/audit-seats-without-payment apply', async () => {
    const rows = [{ action: 'create_pending', seatId: 's1', userId: 'u1', eventId: 'e1', eventDate: '2026-09-20' }] as any
    expect(await auditApply(rows)).toEqual({ created: 1, skipped: 0 })
    expectEventLockFirst()
  })
})

// ── c ──────────────────────────────────────────────────────────────────────
describe('c. the sweep continues past a failed backfill', () => {
  const dates: Record<number, string> = { 0: '2026-09-14', 2: '2026-09-16', [-3]: '2026-09-11' }
  beforeEach(() => {
    h.city.citiesByToday.mockImplementation(async (off = 0) => [{ date: dates[off], cityIds: ['c1'] }])
    p.event.findMany.mockResolvedValue([
      { id: 'e1', title: 'Wine Night', hostId: 'host' },
      { id: 'e2', title: 'Board Games', hostId: 'host' },
    ])
    p.event.findUnique.mockImplementation(async ({ where }: any) => ({ ...collectEvent, id: where.id, date: '2026-09-15' }))
    p.eventAttendee.findMany.mockImplementation(async ({ where }: any) => where.OR ? [] : [{ userId: `u-${where.eventId}` }])
  })

  it('a deadlock abort on the first event is counted and logged; the second is still backfilled and reminded', async () => {
    let first = true
    p.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes('FOR UPDATE') && first) { first = false; throw Object.assign(new Error('deadlock detected'), { code: '40P01' }) }
      return []
    })
    // e1: u-e1 already had a pending row (still reminded), v-e1 has none, so
    // e1's backfill opens a transaction and is the one aborted.
    p.eventAttendee.findMany.mockImplementation(async ({ where }: any) =>
      where.OR ? [] : where.eventId === 'e1' ? [{ userId: 'u-e1' }, { userId: 'v-e1' }] : [{ userId: 'u-e2' }])
    ledger.push({ id: 'had', userId: 'u-e1', eventId: 'e1', status: 'pending', reminderSentAt: null })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const res = await sweepPOST(cronReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, events: 2, backfilled: 1, backfillFailed: 1, reminded: 2 })
    expect(ledger.filter(r => r.eventId === 'e2').map(r => r.userId)).toEqual(['u-e2'])
    expect(h.createNotification.mock.calls.map(c => c[0]).sort()).toEqual(['u-e1', 'u-e2'])
    expect(err).toHaveBeenCalledWith('[cron sweep-payment-reminders] backfill failed', expect.objectContaining({ eventId: 'e1' }))
    expect(h.recordCronRun).toHaveBeenCalledWith('sweep-payment-reminders', true)
    err.mockRestore()
  })

  it('a clean run reports backfillFailed: 0', async () => {
    const body = await (await sweepPOST(cronReq())).json()
    expect(body).toMatchObject({ ok: true, backfilled: 2, backfillFailed: 0 })
    expect(h.recordCronRun).toHaveBeenCalledWith('sweep-payment-reminders', true)
  })
})
