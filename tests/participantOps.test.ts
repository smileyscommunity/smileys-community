import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({ isAdmin: vi.fn(), isClubHost: vi.fn(), canManageEventOps: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',   () => ({ sendEventApprovedEmail: vi.fn().mockResolvedValue(undefined), sendEventRejectedEmail: vi.fn().mockResolvedValue(undefined), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/spotsLeft',    () => ({ recomputeSpotsLeft: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit',        () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/eventQuota',   () => ({ findPromotableFromWaitlist: vi.fn(), hasQuotaRoomFor: vi.fn(), quotaEventSelect: {} }))
vi.mock('@/lib/noShow',       () => ({ getRsvpGate: vi.fn(), gateErrorBody: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:  vi.fn(),
  event:         { findUnique: vi.fn() },
  user:          { findUnique: vi.fn() },
  eventAttendee: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn() },
  waitlistEntry: { findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  payment:       { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  paymentLog:    { create: vi.fn(), createMany: vi.fn() },
} }))

import { DELETE, PATCH, POST, PUT } from '@/app/api/admin/events/[id]/participants/route'
import { getSession } from '@/lib/session'
import { canManageEventOps } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { writeAudit } from '@/lib/audit'
import { findPromotableFromWaitlist, hasQuotaRoomFor } from '@/lib/eventQuota'
import { getRsvpGate } from '@/lib/noShow'

// The host/admin door controls: remove (with waitlist promotion), promote,
// move to waitlist, and the paid checklist. lib/attendance runs for real so
// the assertions are on the rows it would write.

const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any) => ({ json: async () => body }) as any
const p = prisma as any

const writeMocks = () => [
  p.eventAttendee.update, p.eventAttendee.updateMany, p.eventAttendee.create,
  p.waitlistEntry.delete, p.waitlistEntry.deleteMany, p.waitlistEntry.upsert,
  p.payment.update, p.payment.create, p.payment.updateMany,
  p.paymentLog.create, p.paymentLog.createMany, p.$transaction,
]

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'h1', name: 'Host', role: 'host' })
  ;(canManageEventOps as any).mockResolvedValue(true)
  ;(getRsvpGate as any).mockResolvedValue({ ok: true })
  ;(hasQuotaRoomFor as any).mockResolvedValue({ ok: true })
  ;(findPromotableFromWaitlist as any).mockResolvedValue(null)
  p.$transaction.mockImplementation(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(p))
  p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
  p.eventAttendee.create.mockResolvedValue({})
  p.eventAttendee.update.mockResolvedValue({})
  p.waitlistEntry.delete.mockResolvedValue({})
  p.waitlistEntry.deleteMany.mockResolvedValue({ count: 1 })
  p.waitlistEntry.upsert.mockResolvedValue({ id: 'w9', userId: 'u1', createdAt: new Date() })
  p.payment.findMany.mockResolvedValue([])
  p.user.findUnique.mockResolvedValue({ name: 'M', email: 'm@x', gender: null, nationality: null })
})

describe('participants DELETE — removing an approved attendee', () => {
  beforeEach(() => {
    p.event.findUnique.mockResolvedValue({ title: 'Picnic', approvalRequired: false, totalSpots: 12 })
  })

  it('soft-removes them, promotes the next eligible waitlist entry with a waitlist_promoted notice, recomputes spots', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    ;(findPromotableFromWaitlist as any).mockResolvedValue({ id: 'w2', userId: 'u2' })

    const res = await DELETE(req({ userId: 'u1' }), params)
    expect(res.status).toBe(200)

    const updates = p.eventAttendee.updateMany.mock.calls.map((c: any) => c[0])
    // Removal of u1, stamped as the host.
    expect(updates[0].where).toEqual({ userId: 'u1', eventId: 'e1', status: { in: ['approved', 'pending'] } })
    expect(updates[0].data).toMatchObject({ status: 'removed', cancelledBy: 'host' })

    // Promotion of u2: waitlist row gone, attendee activated as approved.
    expect(findPromotableFromWaitlist).toHaveBeenCalledWith('e1', expect.objectContaining({ totalSpots: 12 }))
    expect(p.waitlistEntry.delete).toHaveBeenCalledWith({ where: { id: 'w2' } })
    const revive = updates.find((u: any) => u.where.userId === 'u2')
    expect(revive.data.status).toBe('approved')
    expect(p.eventAttendee.create).toHaveBeenCalledWith({ data: { userId: 'u2', eventId: 'e1', status: 'approved', stealth: false } })

    expect(createNotification).toHaveBeenCalledWith('u2', 'waitlist_promoted', expect.any(String), expect.stringContaining('Picnic'), '/events/e1')
    expect(recomputeSpotsLeft).toHaveBeenCalledWith('e1', 12)
  })

  it('writes an attendee.delete audit row naming the removed member', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    p.payment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'paid' ? [{ id: 'pd1', amount: 250, currency: 'TRY' }] : [])

    await DELETE(req({ userId: 'u1' }), params)
    expect(writeAudit).toHaveBeenCalledTimes(1)
    const [actorId, actorName, action, targetId, targetType, meta] = (writeAudit as any).mock.calls[0]
    expect([actorId, actorName, action, targetId, targetType]).toEqual(['h1', 'Host', 'attendee.delete', 'e1', 'event'])
    expect(meta).toEqual({ userId: 'u1', pendingCount: 0, paidCount: 1, paidTotal: 250 })
  })

  it('no eligible waitlist entry → no promotion or notice, spots still recomputed', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    await DELETE(req({ userId: 'u1' }), params)
    expect(p.waitlistEntry.delete).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
    expect(recomputeSpotsLeft).toHaveBeenCalledWith('e1', 12)
  })

  it('removing a pending request neither promotes nor recomputes', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    await DELETE(req({ userId: 'u1' }), params)
    expect(findPromotableFromWaitlist).not.toHaveBeenCalled()
    expect(recomputeSpotsLeft).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledWith('h1', 'Host', 'attendee.delete', 'e1', 'event', expect.any(Object), expect.any(String))
  })

  it('type=waitlist only deletes that member’s waitlist row', async () => {
    const res = await DELETE(req({ userId: 'u1', type: 'waitlist' }), params)
    expect(res.status).toBe(200)
    expect(p.waitlistEntry.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'e1', userId: 'u1' } })
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    expect(writeAudit).not.toHaveBeenCalled()
  })
})

describe('participants — missing userId is refused before any write', () => {
  const cases: [string, (b: any) => Promise<Response>][] = [
    ['POST',   b => POST(req(b), params)],
    ['PUT',    b => PUT(req(b), params)],
    ['DELETE', b => DELETE(req(b), params)],
  ]
  for (const [name, call] of cases) {
    for (const body of [{}, { userId: '' }, { userId: 42 }, { userId: null }]) {
      it(`${name} ${JSON.stringify(body)} → 400, nothing written`, async () => {
        const res = await call(body)
        expect(res.status).toBe(400)
        for (const m of writeMocks()) expect(m).not.toHaveBeenCalled()
        expect(p.event.findUnique).not.toHaveBeenCalled()
      })
    }
    it(`${name} with an unparseable body → 400`, async () => {
      const bad = { json: async () => { throw new SyntaxError('bad json') } } as any
      const fn = name === 'POST' ? POST : name === 'PUT' ? PUT : DELETE
      const res = await fn(bad, params)
      expect(res.status).toBe(400)
      for (const m of writeMocks()) expect(m).not.toHaveBeenCalled()
    })
  }
})

describe('participants POST — promote from waitlist', () => {
  it('moves a waitlisted member into an approved seat and recomputes spots', async () => {
    p.event.findUnique.mockResolvedValue({ approvalRequired: false, hostId: 'h1', status: 'published', totalSpots: 8 })
    p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
    p.eventAttendee.findUnique.mockResolvedValue(null)

    const res = await POST(req({ userId: 'u1' }), params)
    expect(res.status).toBe(200)
    expect(p.waitlistEntry.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'e1', userId: 'u1' } })
    expect(p.eventAttendee.create).toHaveBeenCalledWith({ data: { userId: 'u1', eventId: 'e1', status: 'approved', stealth: false } })
    expect(recomputeSpotsLeft).toHaveBeenCalledWith('e1', 8)
  })

  it.each(['cancelled', 'archived'])('refuses to promote into a %s event', async (status) => {
    p.event.findUnique.mockResolvedValue({ approvalRequired: false, hostId: 'h1', status, totalSpots: 8 })
    const res = await POST(req({ userId: 'u1' }), params)
    expect(res.status).toBe(400)
    for (const m of writeMocks()) expect(m).not.toHaveBeenCalled()
  })
})

describe('participants PATCH approve — closed events', () => {
  it.each(['cancelled', 'archived'])('approve on a %s event → 400, no seat written', async (status) => {
    p.event.findUnique.mockResolvedValue({ title: 'T', status, totalSpots: 10, genderBalance: false, turkishMaleQuota: null })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })

    const res = await PATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(res.status).toBe(400)
    expect(p.eventAttendee.update).not.toHaveBeenCalled()
    expect(recomputeSpotsLeft).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })
})

describe('participants PATCH toWaitlist', () => {
  beforeEach(() => {
    p.event.findUnique.mockResolvedValue({ title: 'Picnic', status: 'published', totalSpots: 10, genderBalance: false, turkishMaleQuota: null })
  })

  it('an approved attendee: removed, upserted onto the waitlist, attendee.to_waitlist audited, spots recomputed', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    p.payment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'pending' ? [{ id: 'pp1', amount: 100, currency: 'TRY' }] : [])

    const res = await PATCH(req({ userId: 'u1', action: 'toWaitlist' }), params)
    expect(res.status).toBe(200)
    expect((await res.json()).waitlisted).toMatchObject({ id: 'w9', userId: 'u1' })

    expect(p.eventAttendee.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'removed', cancelledBy: 'host' })
    expect(p.waitlistEntry.upsert.mock.calls[0][0]).toMatchObject({
      where: { userId_eventId: { userId: 'u1', eventId: 'e1' } }, create: { userId: 'u1', eventId: 'e1' }, update: {},
    })
    // A pending charge does not outlive the seat.
    expect(p.payment.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', eventId: 'e1', status: 'pending' }, data: { status: 'cancelled' } })
    expect(p.paymentLog.createMany.mock.calls[0][0].data[0]).toMatchObject({ paymentId: 'pp1', fromStatus: 'pending', toStatus: 'cancelled' })

    expect((writeAudit as any).mock.calls[0][2]).toBe('attendee.to_waitlist')
    expect(recomputeSpotsLeft).toHaveBeenCalledWith('e1', 10)
    expect(createNotification).toHaveBeenCalledWith('u1', 'waitlist', expect.any(String), expect.any(String), '/events/e1')
  })

  it('a pending request moved to the waitlist does not recompute spots', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    const res = await PATCH(req({ userId: 'u1', action: 'toWaitlist' }), params)
    expect(res.status).toBe(200)
    expect(recomputeSpotsLeft).not.toHaveBeenCalled()
  })

  it('a non-attendee → 404, nothing moved', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'cancelled' })
    const res = await PATCH(req({ userId: 'u1', action: 'toWaitlist' }), params)
    expect(res.status).toBe(404)
    expect(p.waitlistEntry.upsert).not.toHaveBeenCalled()
    expect(writeAudit).not.toHaveBeenCalled()
  })
})

describe('participants PATCH reject — audit', () => {
  it('writes an attendee.reject audit row', async () => {
    p.event.findUnique.mockResolvedValue({ title: 'T', status: 'published', totalSpots: 10 })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    const res = await PATCH(req({ userId: 'u1', action: 'reject' }), params)
    expect(res.status).toBe(200)
    expect((writeAudit as any).mock.calls[0][2]).toBe('attendee.reject')
  })
})

describe('participants PATCH markPaid', () => {
  it('is admin-only — a host gets 403 and no payment is touched', async () => {
    const res = await PATCH(req({ userId: 'u1', action: 'markPaid' }), params)
    expect(res.status).toBe(403)
    expect(p.payment.findFirst).not.toHaveBeenCalled()
    expect(p.payment.update).not.toHaveBeenCalled()
  })

  describe('as admin', () => {
    beforeEach(() => {
      ;(getSession as any).mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin' })
      p.event.findUnique.mockResolvedValue({ title: 'Picnic', price: 300, currency: 'TRY' })
    })

    it('flips an existing pending payment to paid and logs pending → paid', async () => {
      p.payment.findFirst.mockResolvedValue({ id: 'pay1', status: 'pending' })
      p.payment.update.mockResolvedValue({ id: 'pay1', status: 'paid' })
      const res = await PATCH(req({ userId: 'u1', action: 'markPaid' }), params)
      expect(res.status).toBe(200)
      expect(p.payment.findFirst.mock.calls[0][0].where).toEqual({ userId: 'u1', eventId: 'e1', status: { in: ['pending', 'paid'] } })
      expect(p.payment.update).toHaveBeenCalledWith({ where: { id: 'pay1' }, data: { status: 'paid' } })
      expect(p.paymentLog.create.mock.calls[0][0].data).toMatchObject({ paymentId: 'pay1', adminId: 'a1', fromStatus: 'pending', toStatus: 'paid' })
      expect(p.payment.create).not.toHaveBeenCalled()
    })

    it('already paid → idempotent, no write', async () => {
      p.payment.findFirst.mockResolvedValue({ id: 'pay1', status: 'paid' })
      const res = await PATCH(req({ userId: 'u1', action: 'markPaid' }), params)
      expect(res.status).toBe(200)
      expect(p.payment.update).not.toHaveBeenCalled()
      expect(p.paymentLog.create).not.toHaveBeenCalled()
    })

    it('no ledger row → creates a manual paid payment at the event price, logged null → paid', async () => {
      p.payment.findFirst.mockResolvedValue(null)
      p.payment.create.mockResolvedValue({ id: 'new1', status: 'paid' })
      const res = await PATCH(req({ userId: 'u1', action: 'markPaid' }), params)
      expect(res.status).toBe(200)
      expect(p.payment.create).toHaveBeenCalledWith({
        data: { userId: 'u1', eventId: 'e1', amount: 300, currency: 'TRY', status: 'paid', method: 'manual' },
      })
      expect(p.paymentLog.create.mock.calls[0][0].data).toMatchObject({ paymentId: 'new1', fromStatus: null, toStatus: 'paid' })
    })

    it('unknown event → 404', async () => {
      p.event.findUnique.mockResolvedValue(null)
      const res = await PATCH(req({ userId: 'u1', action: 'markPaid' }), params)
      expect(res.status).toBe(404)
      expect(p.payment.findFirst).not.toHaveBeenCalled()
    })
  })
})
