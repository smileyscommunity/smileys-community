import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',     () => ({ sendRsvpConfirmationEmail: vi.fn(), sendSpotOpenedEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/push',      () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/autoJoinClub',   () => ({ autoJoinClub: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/firstEvent',     () => ({ stampFirstEventRsvp: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/eventQuota',     () => ({ hasQuotaRoomFor: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:  vi.fn(),
  event:         { findUnique: vi.fn() },
  user:          { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  eventAttendee: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  eventCoHost:   { findFirst: vi.fn() },
  waitlistEntry: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), delete: vi.fn(), create: vi.fn() },
  payment:       { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
  paymentLog:    { createMany: vi.fn() },
} }))

import { POST, DELETE } from '@/app/api/events/[id]/rsvp/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

// A member's cancel used to DELETE the attendee row. It now soft-cancels —
// the row stays with status 'cancelled' and a timestamp — and a later join
// revives that row instead of tripping the unique key. These pin the two
// route-level consequences: what DELETE writes, and that POST treats a
// cancelled row as "not attending".

const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any = {}) => ({ json: async () => body }) as any
const p = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'U', email: 'u@x', role: 'member' })
  // Array-style $transaction: resolve the PrismaPromises it was handed.
  p.$transaction.mockImplementation(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(p))
  p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
  p.waitlistEntry.findMany.mockResolvedValue([])
  p.payment.findMany.mockResolvedValue([])
  p.event.findUnique.mockResolvedValue({ title: 'T', approvalRequired: false, totalSpots: 10, date: '2026-09-12' })
})

describe('DELETE /events/[id]/rsvp — soft-cancel', () => {
  it('marks the row cancelled by the member instead of deleting it', async () => {
    p.waitlistEntry.findUnique.mockResolvedValue(null)
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })

    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(p.eventAttendee.delete).not.toHaveBeenCalled()
    const call = p.eventAttendee.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ userId: 'u1', eventId: 'e1', status: { in: ['approved', 'pending'] } })
    expect(call.data).toMatchObject({ status: 'cancelled', cancelledBy: 'member' })
    expect(call.data.cancelledAt).toBeInstanceOf(Date)
  })

  it('refuses to cancel a row that is already cancelled', async () => {
    p.waitlistEntry.findUnique.mockResolvedValue(null)
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'cancelled' })

    const res = await DELETE(req(), params)
    expect(res.status).toBe(400)
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })
})

describe('POST /events/[id]/rsvp — a cancelled row is not "already joined"', () => {
  it('lets a co-host who cancelled earlier join again, reviving the row', async () => {
    p.event.findUnique.mockResolvedValue({ id: 'e1', title: 'T', hostId: 'h1', cityId: 'c1' })
    p.user.findUnique.mockResolvedValue({ status: 'approved', gender: null, nationality: null })
    p.eventCoHost.findFirst.mockResolvedValue({ id: 'ch1' })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'cancelled' })

    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    // Revival path: updateMany on the history statuses, no create.
    expect(p.eventAttendee.updateMany.mock.calls[0][0].where)
      .toEqual({ userId: 'u1', eventId: 'e1', status: { in: ['cancelled', 'removed'] } })
    expect(p.eventAttendee.create).not.toHaveBeenCalled()
  })

  it('still rejects a co-host whose RSVP is live', async () => {
    p.event.findUnique.mockResolvedValue({ id: 'e1', title: 'T', hostId: 'h1', cityId: 'c1' })
    p.user.findUnique.mockResolvedValue({ status: 'approved', gender: null, nationality: null })
    p.eventCoHost.findFirst.mockResolvedValue({ id: 'ch1' })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })

    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  })
})
