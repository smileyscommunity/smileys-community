import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({ isAdmin: vi.fn(), isClubHost: vi.fn(), canManageEventOps: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',   () => ({ sendEventApprovedEmail: vi.fn().mockResolvedValue(undefined), sendEventRejectedEmail: vi.fn().mockResolvedValue(undefined), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/spotsLeft',    () => ({ recomputeSpotsLeft: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit',        () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/eventQuota',   () => ({ findPromotableFromWaitlist: vi.fn(), hasQuotaRoomFor: vi.fn(), quotaEventSelect: {} }))
vi.mock('@/lib/noShow',       () => ({ getRsvpGate: vi.fn().mockResolvedValue({ ok: true }), gateErrorBody: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:  vi.fn(),
  event:         { findUnique: vi.fn() },
  user:          { findUnique: vi.fn() },
  eventAttendee: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  waitlistEntry: { upsert: vi.fn() },
  payment:       { findMany: vi.fn().mockResolvedValue([]) },
  paymentLog:    { createMany: vi.fn() },
} }))

import { PATCH } from '@/app/api/admin/events/[id]/participants/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { sendEventRejectedEmail } from '@/lib/email'

// Attendee rows now survive a cancel. A host's participants tab that was
// opened before the member withdrew still shows the request, and one click
// used to be enough to approve them into a spot they had given up (or mail
// a rejection for a request they cancelled). Approve and reject must act
// on live rows only.

const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any) => ({ json: async () => body }) as any
const p = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'h1', name: 'Host', role: 'host' })
  p.event.findUnique.mockResolvedValue({ title: 'T', status: 'published', totalSpots: 10, genderBalance: false, turkishMaleQuota: null })
  p.user.findUnique.mockResolvedValue({ name: 'M', email: 'm@x', gender: null, nationality: null })
  p.payment.findMany.mockResolvedValue([])
})

describe('participants PATCH on a withdrawn request', () => {
  it('approve → 404, nothing written, no spot recomputed', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'cancelled' })
    const res = await PATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(res.status).toBe(404)
    expect(p.eventAttendee.update).not.toHaveBeenCalled()
  })

  it('reject → 404 and no rejection email', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'removed' })
    const res = await PATCH(req({ userId: 'u1', action: 'reject' }), params)
    expect(res.status).toBe(404)
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
    expect(sendEventRejectedEmail).not.toHaveBeenCalled()
  })

  it('approve on a live pending request still goes through', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    p.eventAttendee.update.mockResolvedValue({})
    const res = await PATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(res.status).toBe(200)
    expect(p.eventAttendee.update).toHaveBeenCalledWith({
      where: { userId_eventId: { userId: 'u1', eventId: 'e1' } },
      data:  { status: 'approved' },
    })
  })

  it("reject on a live request soft-removes it as the host", async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
    const res = await PATCH(req({ userId: 'u1', action: 'reject' }), params)
    expect(res.status).toBe(200)
    const call = p.eventAttendee.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ userId: 'u1', eventId: 'e1', status: { in: ['approved', 'pending'] } })
    expect(call.data).toMatchObject({ status: 'removed', cancelledBy: 'host' })
  })
})
