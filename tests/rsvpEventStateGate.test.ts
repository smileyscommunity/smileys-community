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
vi.mock('@/lib/noShow', () => ({ checkRsvpAllowed: vi.fn().mockResolvedValue({ ok: true }), getRsvpGate: vi.fn().mockResolvedValue({ ok: true }), gateErrorBody: vi.fn() }))
vi.mock('@/lib/city',   () => ({ todayInCity: vi.fn().mockResolvedValue('2026-09-10') }))
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

import { POST } from '@/app/api/events/[id]/rsvp/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'

// The event page hides the RSVP button on cancelled, draft, pending and past
// events; the API never checked any of it. A direct POST created an approved
// seat, sent the confirmation email and pinged the host for a dead event —
// and the no-show sweeper could then settle a card against it.
// registrationDeadline was validated on create and never read again.

const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any = {}) => ({ json: async () => body }) as any
const p = prisma as any

const openEvent = {
  id: 'e1', title: 'T', hostId: 'h1', cityId: 'c1', status: 'published', cancelledAt: null,
  date: '2026-09-12', registrationDeadline: null, totalSpots: 10, spotsLeft: 5, limitedSpots: true,
  approvalRequired: false, price: 0, memberPrice: null, soldOut: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'U', email: 'u@x', role: 'member' })
  p.user.findUnique.mockResolvedValue({ status: 'approved', gender: null, nationality: null })
  p.eventCoHost.findFirst.mockResolvedValue(null)
  p.eventAttendee.findUnique.mockResolvedValue(null)
  p.waitlistEntry.findUnique.mockResolvedValue(null)
})

async function expectRefused(event: Record<string, unknown>, message: RegExp) {
  p.event.findUnique.mockResolvedValue({ ...openEvent, ...event })
  const res = await POST(req(), params)
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(message)
  expect(p.$transaction).not.toHaveBeenCalled()
  expect(p.eventAttendee.create).not.toHaveBeenCalled()
  expect(p.eventAttendee.updateMany).not.toHaveBeenCalled()
  expect(createNotification).not.toHaveBeenCalled()
}

describe('POST /events/[id]/rsvp — event must actually be open', () => {
  it('refuses a cancelled event', () => expectRefused({ status: 'cancelled' }, /not open/))
  it('refuses an event with cancelledAt set even if status lags', () => expectRefused({ cancelledAt: new Date() }, /not open/))
  it('refuses a draft', () => expectRefused({ status: 'draft' }, /not open/))
  it('refuses an event still pending review', () => expectRefused({ status: 'pending' }, /not open/))
  it('refuses an event that already happened (city calendar)', () => expectRefused({ date: '2026-09-09' }, /already happened/))
  it('refuses once the registration deadline has passed', () => expectRefused({ registrationDeadline: '2026-09-09' }, /closed/))

  it('applies before the co-host shortcut too', async () => {
    p.eventCoHost.findFirst.mockResolvedValue({ id: 'ch1' })
    await expectRefused({ status: 'cancelled' }, /not open/)
  })

  it('lets a published, future, open event through to the join path', async () => {
    p.event.findUnique.mockResolvedValue({ ...openEvent, date: '2026-09-10', registrationDeadline: '2026-09-10' })
    // Past the gate the route locks the row inside $transaction; a throw here
    // proves we got that far without reproducing the whole join.
    p.$transaction.mockRejectedValue(new Error('reached-transaction'))
    const res = await POST(req(), params)
    expect(res.status).toBe(500)
    expect(p.$transaction).toHaveBeenCalled()
  })
})
