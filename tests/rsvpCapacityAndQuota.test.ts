import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',     () => ({ sendRsvpConfirmationEmail: vi.fn().mockResolvedValue(undefined), sendSpotOpenedEmail: vi.fn(), recordEmailFailure: vi.fn() }))
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
  $queryRaw:     vi.fn().mockResolvedValue([]),
  city:          { findUnique: vi.fn().mockResolvedValue({ timezone: 'Europe/Istanbul' }) },
  event:         { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  user:          { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  eventAttendee: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), delete: vi.fn(), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  eventCoHost:   { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  waitlistEntry: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), delete: vi.fn(), create: vi.fn(), count: vi.fn().mockResolvedValue(1) },
  payment:       { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
  paymentLog:    { createMany: vi.fn() },
} }))

import { POST } from '@/app/api/events/[id]/rsvp/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { hasQuotaRoomFor } from '@/lib/eventQuota'

// Two capacity rules the scan found disagreeing with the page:
//  - "limited spots" OFF still stored a 20-spot counter and both join paths
//    gated on it, so the 21st person on an unlimited event was waitlisted
//    while the card said open.
//  - the direct RSVP path hand-rolled the gender quota and read a null
//    femaleQuota as "no cap", while the waitlist claim and admin promotion
//    used lib/eventQuota's "half" fallback. One rule now.

const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any = {}) => ({ json: async () => body }) as any
const p = prisma as any

const event = {
  id: 'e1', title: 'T', hostId: 'h1', cityId: 'c1', status: 'published', cancelledAt: null,
  date: '2026-09-12', registrationDeadline: null, totalSpots: 20, spotsLeft: 0, limitedSpots: false,
  approvalRequired: false, price: 0, memberPrice: null, soldOut: false, genderBalance: false,
  maleQuota: null, femaleQuota: null, turkishMaleQuota: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'U', email: 'u@x', role: 'member' })
  p.$transaction.mockImplementation(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(p))
  p.user.findUnique.mockResolvedValue({ status: 'approved', gender: 'female', nationality: 'Germany', email: 'u@x', name: 'U' })
  p.eventCoHost.findFirst.mockResolvedValue(null)
  p.eventAttendee.findUnique.mockResolvedValue(null)
  p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
  p.eventAttendee.create.mockResolvedValue({})
  p.waitlistEntry.findUnique.mockResolvedValue(null)
  p.event.updateMany.mockResolvedValue({ count: 1 })
})

describe('unlimited-spots events', () => {
  it('joins past the nominal counter instead of waitlisting', async () => {
    p.event.findUnique.mockResolvedValue({ ...event, limitedSpots: false, spotsLeft: 0 })
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('approved')
    expect(p.event.updateMany.mock.calls[0][0].where).toEqual({ id: 'e1' })
    expect(p.waitlistEntry.create).not.toHaveBeenCalled()
  })

  it('still gates a limited event on the counter', async () => {
    p.event.findUnique.mockResolvedValue({ ...event, limitedSpots: true, spotsLeft: 0 })
    p.event.updateMany.mockResolvedValue({ count: 0 })
    const res = await POST(req(), params)
    expect((await res.json()).status).toBe('waitlisted')
    expect(p.event.updateMany.mock.calls[0][0].where).toEqual({ id: 'e1', spotsLeft: { gt: 0 } })
  })

  it('a claim from the waitlist is not gated on an unlimited event either', async () => {
    p.event.findUnique.mockResolvedValue({ ...event, limitedSpots: false, spotsLeft: -3 })
    p.waitlistEntry.findUnique.mockResolvedValue({ id: 'w1' })
    ;(hasQuotaRoomFor as any).mockResolvedValue({ ok: true })
    const res = await POST(req(), params)
    expect((await res.json()).status).toBe('approved')
    expect(p.event.updateMany.mock.calls[0][0].where).toEqual({ id: 'e1' })
  })
})

describe('direct RSVP uses the shared quota rule', () => {
  it('asks hasQuotaRoomFor under the row lock and waitlists on its verdict', async () => {
    p.event.findUnique.mockResolvedValue({ ...event, limitedSpots: true, spotsLeft: 5, genderBalance: true })
    ;(hasQuotaRoomFor as any).mockResolvedValue({ ok: false, reason: 'female_quota' })
    const res = await POST(req(), params)
    const body = await res.json()
    expect(body.status).toBe('waitlisted')
    const call = (hasQuotaRoomFor as any).mock.calls[0]
    expect(call[0]).toBe('e1')
    expect(call[2]).toEqual({ gender: 'female', nationality: 'Germany' })
    expect(call[3]).toBe(p)   // the transaction client, not the global one
    expect(p.event.updateMany).not.toHaveBeenCalled()
  })

  it('does not consult the rule when balance is off', async () => {
    p.event.findUnique.mockResolvedValue({ ...event, limitedSpots: true, spotsLeft: 5, genderBalance: false })
    const res = await POST(req(), params)
    expect((await res.json()).status).toBe('approved')
    expect(hasQuotaRoomFor).not.toHaveBeenCalled()
  })
})
