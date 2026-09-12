import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({ isAdmin: vi.fn(), isClubHost: vi.fn(), canManageEventOps: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',   () => ({ sendEventApprovedEmail: vi.fn(), sendEventRejectedEmail: vi.fn(), recordEmailFailure: vi.fn() }))
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
  waitlistEntry: { upsert: vi.fn(), deleteMany: vi.fn() },
  payment:       { findMany: vi.fn().mockResolvedValue([]) },
  paymentLog:    { createMany: vi.fn() },
} }))

import { POST, DELETE } from '@/app/api/admin/events/[id]/participants/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { cancelAttendeeOp, withdrawPendingOp } from '@/lib/attendance'

const read = (p: string) => readFileSync(p, 'utf-8')
const params = { params: Promise.resolve({ id: 'e1' }) }
const req = (body: any) => ({ json: async () => body }) as any
const p = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'h1', name: 'Host', role: 'host' })
  p.event.findUnique.mockResolvedValue({ title: 'T', status: 'published', totalSpots: 10, approvalRequired: false })
})

describe('1 participants: an id, or nothing', () => {
  // Prisma drops an undefined filter: an empty body used to delete the whole
  // waitlist, and on promote revive every cancelled row on the event.
  it('promote with no userId is a 400 and touches nothing', async () => {
    const res = await POST(req({}), params)
    expect(res.status).toBe(400)
    expect(p.$transaction).not.toHaveBeenCalled()
  })
  it('waitlist removal with no userId is a 400 and deletes nothing', async () => {
    const res = await DELETE(req({ type: 'waitlist' }), params)
    expect(res.status).toBe(400)
    expect(p.waitlistEntry.deleteMany).not.toHaveBeenCalled()
  })
  it('a malformed body is a 400, not a 500', async () => {
    const res = await POST({ json: async () => { throw new Error('bad json') } } as any, params)
    expect(res.status).toBe(400)
  })
})

describe('2 a withdrawn request never held a seat', () => {
  const db = { eventAttendee: { updateMany: vi.fn() } } as any
  it("the member's own cancel stamps approved rows only", () => {
    cancelAttendeeOp(db, { userId: 'u', eventId: 'e', by: 'member' })
    expect(db.eventAttendee.updateMany.mock.calls.at(-1)[0].where).toEqual({ userId: 'u', eventId: 'e', status: 'approved' })
  })
  it('a host removal still covers pending rows', () => {
    cancelAttendeeOp(db, { userId: 'u', eventId: 'e', by: 'host' })
    expect(db.eventAttendee.updateMany.mock.calls.at(-1)[0].where).toEqual({ userId: 'u', eventId: 'e', status: { in: ['approved', 'pending'] } })
  })
  it('withdrawing a pending request is stamped as withdrawn, not as a member cancel', () => {
    withdrawPendingOp(db, { userId: 'u', eventId: 'e' })
    const call = db.eventAttendee.updateMany.mock.calls.at(-1)[0]
    expect(call.where).toEqual({ userId: 'u', eventId: 'e', status: 'pending' })
    expect(call.data).toMatchObject({ status: 'cancelled', cancelledBy: 'withdrawn' })
  })
})

describe('3 admin new-event form', () => {
  it('only re-picks the host when the chosen one does not host the club, and keeps the label in step', () => {
    const src = read('app/admin/events/new/page.tsx')
    expect(src).toMatch(/if \(clubHosts\.some\(h => h\.id === f\.hostId\)\) return f/)
    expect(src).toMatch(/setHostSearch\(clubHosts\[0\]\.name \?\? ''\)/)
  })
})

describe('4 decompression bombs', () => {
  it.each(['app/api/upload/route.ts', 'app/api/apply/upload/route.ts', 'app/api/admin/neighborhoods/[slug]/image/route.ts'])('%s caps input pixels', (f) => {
    const src = read(f)
    expect(src).toMatch(/const MAX_INPUT_PIXELS = 50_000_000/)
    expect(src).toMatch(/sharp\(raw, \{ limitInputPixels: MAX_INPUT_PIXELS \}\)/)
    expect(src).not.toMatch(/sharp\(raw\)/)
  })
})
