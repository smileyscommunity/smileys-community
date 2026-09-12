import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',     () => ({ sendRsvpConfirmationEmail: vi.fn(), sendSpotOpenedEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/push',      () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/spotOpened', () => ({ announceSpotOpened: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/autoJoinClub',   () => ({ autoJoinClub: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/firstEvent',     () => ({ stampFirstEventRsvp: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/eventQuota',     () => ({ hasQuotaRoomFor: vi.fn() }))
vi.mock('@/lib/city',           () => ({ todayInCity: vi.fn().mockResolvedValue('2026-09-10') }))
vi.mock('@/lib/noShow', () => ({ checkRsvpAllowed: vi.fn().mockResolvedValue({ ok: true }), getRsvpGate: vi.fn().mockResolvedValue({ ok: true }), gateErrorBody: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:  vi.fn(),
  event:         { findUnique: vi.fn() },
  user:          { findUnique: vi.fn(), findMany: vi.fn() },
  eventAttendee: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  waitlistEntry: { findUnique: vi.fn(), delete: vi.fn() },
  payment:       { findMany: vi.fn(), updateMany: vi.fn() },
  paymentLog:    { createMany: vi.fn() },
} }))

import { DELETE } from '@/app/api/events/[id]/rsvp/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { announceSpotOpened } from '@/lib/spotOpened'
import { createNotification } from '@/lib/notify'

// The member's own cancel has three branches rsvpSoftCancel.test.ts does not
// reach: leaving the waitlist, voiding pending payments, and flagging paid
// ones for refund review. Plus the rule that only a held seat is announced
// to the waitlist as "spot opened".

const params = { params: Promise.resolve({ id: 'e1' }) }
const req = () => ({ json: async () => ({}) }) as any
const p = prisma as any

// payment.findMany is asked twice — pending first, paid second — so answer by status.
function paymentsByStatus(rows: { pending?: any[]; paid?: any[] }) {
  p.payment.findMany.mockImplementation(async ({ where }: any) =>
    where.status === 'pending' ? (rows.pending ?? []) : where.status === 'paid' ? (rows.paid ?? []) : [])
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'Una', email: 'una@x.test', role: 'member' })
  p.$transaction.mockImplementation(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(p))
  p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
  p.payment.updateMany.mockResolvedValue({ count: 0 })
  p.paymentLog.createMany.mockResolvedValue({ count: 0 })
  p.user.findMany.mockResolvedValue([])
  p.event.findUnique.mockResolvedValue({ title: 'Picnic' })
  p.waitlistEntry.findUnique.mockResolvedValue(null)
  paymentsByStatus({})
})

describe('DELETE /events/[id]/rsvp — waitlist branch', () => {
  it('a member on the waitlist leaves it, and no attendee row is touched', async () => {
    p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1', userId: 'u1', eventId: 'e1' })

    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(p.waitlistEntry.delete).toHaveBeenCalledWith({ where: { userId_eventId: { userId: 'u1', eventId: 'e1' } } })
    expect(p.eventAttendee.findUnique).not.toHaveBeenCalled()
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    expect(p.$transaction).not.toHaveBeenCalled()
    expect(p.payment.updateMany).not.toHaveBeenCalled()
    expect(announceSpotOpened).not.toHaveBeenCalled()
  })
})

describe('DELETE /events/[id]/rsvp — payment branches', () => {
  it('pending payments flip to cancelled with one PaymentLog row each', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    paymentsByStatus({ pending: [{ id: 'pay1', amount: 300, currency: 'TRY' }, { id: 'pay2', amount: 50, currency: 'TRY' }] })

    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(p.payment.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', eventId: 'e1', status: 'pending' },
      data:  { status: 'cancelled' },
    })
    expect(p.paymentLog.createMany).toHaveBeenCalledTimes(1)
    const logs = p.paymentLog.createMany.mock.calls[0][0].data
    expect(logs).toHaveLength(2)
    expect(logs[0]).toMatchObject({ paymentId: 'pay1', adminId: 'u1', adminName: 'Una', fromStatus: 'pending', toStatus: 'cancelled' })
    expect(logs[0].note).toContain('Member self-cancel')
    expect(logs[1]).toMatchObject({ paymentId: 'pay2', fromStatus: 'pending', toStatus: 'cancelled' })
    // Nothing paid → no refund heads-up.
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('no pending payments → no PaymentLog row is written', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(p.paymentLog.createMany).not.toHaveBeenCalled()
  })

  it('paid payments stay paid: an informational refund-pending log, and admins are told', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    p.user.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    paymentsByStatus({ paid: [{ id: 'paid1', amount: 400, currency: 'TRY' }] })

    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)

    // The only status write is the pending-scoped updateMany — never one aimed at paid rows.
    for (const [call] of p.payment.updateMany.mock.calls) {
      expect(call.where.status).toBe('pending')
      expect(call.data.status).not.toBe('paid')
    }
    expect(p.paymentLog.createMany).toHaveBeenCalledTimes(1)
    const [log] = p.paymentLog.createMany.mock.calls[0][0].data
    expect(log).toMatchObject({ paymentId: 'paid1', adminId: 'u1', fromStatus: null, toStatus: null })
    expect(log.note).toMatch(/still 'paid', refund pending/)

    expect(p.user.findMany).toHaveBeenCalledWith({ where: { role: 'admin' }, select: { id: true } })
    const notified = (createNotification as any).mock.calls
    expect(notified.map((c: any[]) => c[0]).sort()).toEqual(['a1', 'a2'])
    expect(notified[0][1]).toBe('payment_attention')
    expect(notified[0][3]).toContain('Picnic')
  })

  it('pending and paid together: pending log inside the transaction, refund log after', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    paymentsByStatus({
      pending: [{ id: 'pay1', amount: 100, currency: 'TRY' }],
      paid:    [{ id: 'paid1', amount: 400, currency: 'TRY' }],
    })

    await DELETE(req(), params)
    expect(p.paymentLog.createMany).toHaveBeenCalledTimes(2)
    const [first, second] = p.paymentLog.createMany.mock.calls.map((c: any) => c[0].data[0])
    expect(first).toMatchObject({ paymentId: 'pay1', toStatus: 'cancelled' })
    expect(second).toMatchObject({ paymentId: 'paid1', toStatus: null })
  })
})

describe('DELETE /events/[id]/rsvp — spot-opened announcement', () => {
  it('announces when the cancelling member held an approved seat', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })
    await DELETE(req(), params)
    expect(announceSpotOpened).toHaveBeenCalledTimes(1)
    expect(announceSpotOpened).toHaveBeenCalledWith('e1')
  })

  it('does not announce when a pending request is withdrawn', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(announceSpotOpened).not.toHaveBeenCalled()
  })

  it('does not announce when leaving the waitlist', async () => {
    p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
    await DELETE(req(), params)
    expect(announceSpotOpened).not.toHaveBeenCalled()
  })
})
