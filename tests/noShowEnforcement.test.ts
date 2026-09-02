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
vi.mock('@/lib/noShow', () => ({
  checkRsvpAllowed: vi.fn(),
  getRsvpGate:      vi.fn(),
  recordYellowAcknowledgement: vi.fn().mockResolvedValue(undefined),
  gateErrorBody:    (g: any) => ({ error: 'gated', code: g.code, cardId: g.cardId }),
}))
vi.mock('@/lib/access', () => ({ canManageEventOps: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:  vi.fn(),
  event:         { findUnique: vi.fn() },
  user:          { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  eventAttendee: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  eventCoHost:   { findFirst: vi.fn() },
  waitlistEntry: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), deleteMany: vi.fn() },
  payment:       { findMany: vi.fn().mockResolvedValue([]) },
  noShowCard:    { findUnique: vi.fn() },
} }))

import { POST, GET } from '@/app/api/events/[id]/rsvp/route'
import { POST as WAIVE } from '@/app/api/events/[id]/no-shows/waive/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { checkRsvpAllowed, getRsvpGate, recordYellowAcknowledgement } from '@/lib/noShow'
import { canManageEventOps } from '@/lib/access'

// The restriction is enforced where the RSVP is written, not in the button:
// a blocked member gets a machine-readable refusal before any join path
// runs, and a yellow-card member passes only with the confirmation flag.

const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any = {}) => ({ json: async () => body }) as any
const p = prisma as any
const until = new Date('2026-10-20T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'U', email: 'u@x', role: 'member' })
  p.event.findUnique.mockResolvedValue({ id: 'e1', title: 'T', hostId: 'h1', cityId: 'c1', price: 0 })
  p.user.findUnique.mockResolvedValue({ status: 'approved', gender: null, nationality: null })
  p.eventCoHost.findFirst.mockResolvedValue(null)
  p.eventAttendee.findUnique.mockResolvedValue(null)
  p.waitlistEntry.findUnique.mockResolvedValue(null)
})

describe('RSVP POST behind the no-show gate', () => {
  it('red card → 403 with code, and no join path runs (no attendee or waitlist write)', async () => {
    ;(checkRsvpAllowed as any).mockResolvedValue({ ok: false, code: 'red_card_blocked', cardId: 'r', restrictionEndsAt: until, appealDeadlineAt: null })
    const res  = await POST(req(), params)
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('red_card_blocked')
    expect(p.$transaction).not.toHaveBeenCalled()
    expect(p.waitlistEntry.create).not.toHaveBeenCalled()
    expect(p.eventAttendee.create).not.toHaveBeenCalled()
  })

  it('yellow without confirmation → 403 yellow_ack_required', async () => {
    ;(checkRsvpAllowed as any).mockResolvedValue({ ok: false, code: 'yellow_ack_required', cardId: 'y', eventId: 'e0' })
    const res = await POST(req({}), params)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('yellow_ack_required')
    expect(checkRsvpAllowed).toHaveBeenCalledWith('u1', { eventId: 'e1', acknowledge: false })
  })

  it('the confirmation flag is passed through and recorded only after the join lands', async () => {
    ;(checkRsvpAllowed as any).mockResolvedValue({ ok: true, pendingAck: true })
    // Approval-required event: the shortest member happy path (a pending
    // request) — enough to prove the gate saw acknowledge=true and the
    // acknowledgement was written after the row landed.
    p.event.findUnique.mockResolvedValue({ id: 'e1', title: 'T', hostId: 'h1', cityId: 'c1', price: 0, approvalRequired: true, totalSpots: 10, soldOut: false, genderBalance: false })
    p.$transaction.mockImplementation(async (fn: any) => fn(p))
    p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
    p.eventAttendee.create.mockResolvedValue({})
    const res = await POST(req({ acknowledgeNoShow: true }), params)
    expect(res.status).toBe(200)
    expect(checkRsvpAllowed).toHaveBeenCalledWith('u1', { eventId: 'e1', acknowledge: true })
    expect(p.eventAttendee.create).toHaveBeenCalled()
    expect(recordYellowAcknowledgement).toHaveBeenCalledWith('u1', 'e1')
  })

  it('a bounced join with the flag does NOT record the acknowledgement', async () => {
    ;(checkRsvpAllowed as any).mockResolvedValue({ ok: true, pendingAck: true })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved' })   // already joined → 400
    const res = await POST(req({ acknowledgeNoShow: true }), params)
    expect(res.status).toBe(400)
    expect(recordYellowAcknowledgement).not.toHaveBeenCalled()
  })

  it('a co-host is staff: the gate is not consulted for their own event', async () => {
    ;(checkRsvpAllowed as any).mockResolvedValue({ ok: false, code: 'red_card_blocked', cardId: 'r', restrictionEndsAt: until, appealDeadlineAt: null })
    p.eventCoHost.findFirst.mockResolvedValue({ id: 'ch' })
    p.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
    p.eventAttendee.create.mockResolvedValue({})
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(checkRsvpAllowed).not.toHaveBeenCalled()
  })

  it('a banned account is refused before the gate is even consulted', async () => {
    p.user.findUnique.mockResolvedValue({ status: 'banned' })
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
    expect(checkRsvpAllowed).not.toHaveBeenCalled()
  })
})

describe('RSVP GET carries the gate', () => {
  it('reports a paused member so the button can render the state up front', async () => {
    ;(getRsvpGate as any).mockResolvedValue({ ok: false, code: 'red_card_blocked', cardId: 'r', restrictionEndsAt: until, appealDeadlineAt: null })
    const body = await (await GET({} as any, params)).json()
    expect(body.gate).toMatchObject({ code: 'red_card_blocked' })
    expect(body.attending).toBe(false)
  })
  it('is { ok: true } for everyone else', async () => {
    ;(getRsvpGate as any).mockResolvedValue({ ok: true })
    const body = await (await GET({} as any, params)).json()
    expect(body.gate).toEqual({ ok: true })
  })
})

describe('host waiver route authority', () => {
  it('non-host → 403 and the card is never read', async () => {
    ;(canManageEventOps as any).mockResolvedValue(false)
    const res = await WAIVE(req({ cardId: 'c1', reason: 'sorry' }), params)
    expect(res.status).toBe(403)
    expect(p.noShowCard.findUnique).not.toHaveBeenCalled()
  })
  it("a host of THIS event cannot waive a card from ANOTHER event via its id", async () => {
    ;(canManageEventOps as any).mockResolvedValue(true)
    p.noShowCard.findUnique.mockResolvedValue({ eventId: 'someone-elses-event' })
    const res = await WAIVE(req({ cardId: 'c1', reason: 'not mine' }), params)
    expect(res.status).toBe(404)
  })
  it('a reason is required', async () => {
    ;(canManageEventOps as any).mockResolvedValue(true)
    const res = await WAIVE(req({ cardId: 'c1', reason: '' }), params)
    expect(res.status).toBe(400)
  })
})
