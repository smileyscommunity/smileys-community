import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 27–31: moderator queues, report actions, the approval queue,
// and approvals under a lock with an honest "waitlisted" answer.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => {
  const m: Record<string, any> = {
    report:         { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    user:           { findUnique: vi.fn(), update: vi.fn() },
    eventSurvey:    { updateMany: vi.fn() },
    event:          { findUnique: vi.fn() },
    eventAttendee:  { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    waitlistEntry:  { upsert: vi.fn() },
    $queryRaw:      vi.fn(async () => []),
  }
  m.$transaction = vi.fn(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(m))
  return m
})
const h = vi.hoisted(() => ({ session: { current: null as Record<string, unknown> | null } }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => h.session.current) }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => true) }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/email', () => ({ recordEmailFailure: vi.fn(), sendEventApprovedEmail: vi.fn(async () => {}), sendEventRejectedEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/access', () => ({
  isAdmin: (s: { role: string }) => s.role === 'admin',
  isAdminOrModerator: (s: { role: string }) => s.role === 'admin' || s.role === 'moderator',
  isClubHost: vi.fn(async () => false),
  canManageEventOps: vi.fn(async () => true),
}))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn(async () => {}) }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/eventQuota', () => ({ findPromotableFromWaitlist: vi.fn(), hasQuotaRoomFor: vi.fn(async () => ({ ok: true })), quotaEventSelect: {} }))
vi.mock('@/lib/noShow', () => ({ getRsvpGate: vi.fn(async () => ({ ok: true })), gateErrorBody: vi.fn() }))

import { PATCH as reportPATCH } from '@/app/api/admin/moderation/[id]/route'
import { PATCH as participantsPATCH } from '@/app/api/admin/events/[id]/participants/route'

const req = (body: unknown) => ({ json: async () => body }) as any

beforeEach(() => {
  vi.clearAllMocks()
  h.session.current = { id: 'adm', name: 'Admin', role: 'admin', cityId: 'c1' }
})

describe('27. moderator queues mask contact details', () => {
  it('the reports queue masks both parties and the approval queue masks hosts', () => {
    expect(read('app/api/admin/moderation/route.ts')).toContain("maskRows(session, maskRows(session, rows, 'reporter'), 'reported')")
    expect(read('app/api/admin/events/approval/route.ts')).toContain("maskRows(session, result, 'host')")
  })
})

describe('28. report actions act once, on a pending report, with a known action', () => {
  const params = { params: Promise.resolve({ id: 'r1' }) }
  beforeEach(() => {
    p.report.findUnique.mockResolvedValue({ id: 'r1', reportedId: 'bad', reporterId: 'x', status: 'pending', reason: 'spam' })
    p.user.findUnique.mockResolvedValue({ name: 'Bad Actor', cityId: 'c1', status: 'approved' })
  })
  it('an unknown or missing action is a 400 and changes nothing', async () => {
    expect((await reportPATCH(req({ action: 'nuke' }), params)).status).toBe(400)
    expect((await reportPATCH(req({}), params)).status).toBe(400)
    expect(p.report.updateMany).not.toHaveBeenCalled()
  })
  it('a report someone already handled is a 409: no second warning, no notifications', async () => {
    p.report.updateMany.mockResolvedValue({ count: 0 })
    expect((await reportPATCH(req({ action: 'warn' }), params)).status).toBe(409)
    expect(p.user.update).not.toHaveBeenCalled()
    expect(p.report.updateMany.mock.calls[0][0].where).toEqual({ id: 'r1', status: 'pending' })
  })
  it('a pending report is actioned once', async () => {
    p.report.updateMany.mockResolvedValue({ count: 1 })
    expect((await reportPATCH(req({ action: 'warn' }), params)).status).toBe(200)
    expect(p.user.update).toHaveBeenCalledTimes(1)
  })
})

describe('29. the approval queue never offers a cancelled or archived event', () => {
  it('the queue filters them and the page hides Approve and Flag for them', () => {
    expect(read('app/api/admin/events/approval/route.ts')).toContain("status: { notIn: ['cancelled', 'archived'] }")
    const page = read('app/admin/moderation/page.tsx')
    expect(page).toContain("{e.status !== 'published' && e.status !== 'cancelled' && e.status !== 'archived' && (")
    expect(page).toContain("{e.status !== 'flagged' && e.status !== 'cancelled' && e.status !== 'archived' && (")
  })
})

describe('30. approvals are counted and seated under a lock on the event', () => {
  const params = { params: Promise.resolve({ id: 'e1' }) }
  beforeEach(() => {
    p.event.findUnique.mockResolvedValue({ id: 'e1', title: 'Picnic', status: 'published', hostId: 'host', totalSpots: 10, genderBalance: true, maleQuota: 1, femaleQuota: null, turkishMaleQuota: null, approvalRequired: true })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'pending' })
    p.user.findUnique.mockResolvedValue({ name: 'Can', email: 'c@x', gender: 'male', nationality: 'France' })
    p.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
  })
  it('a full side goes to the waitlist inside the locked transaction', async () => {
    p.eventAttendee.count.mockResolvedValue(1)
    const res = await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(await res.json()).toEqual({ ok: true, status: 'waitlisted', reason: 'male_quota' })
    expect(String(p.$queryRaw.mock.calls[0][0].join('?'))).toContain('FOR UPDATE')
    expect(p.waitlistEntry.upsert).toHaveBeenCalledTimes(1)
    expect(p.eventAttendee.update).not.toHaveBeenCalled()
  })
  it('with room, the seat is written inside the same locked transaction', async () => {
    p.eventAttendee.count.mockResolvedValue(0)
    const res = await participantsPATCH(req({ userId: 'u1', action: 'approve' }), params)
    expect(res.status).toBe(200)
    expect(p.$queryRaw).toHaveBeenCalledTimes(1)
    // The seat dates from the approval (standing's late-seat rule reads joinedAt).
    expect(p.eventAttendee.update).toHaveBeenCalledWith({ where: { userId_eventId: { userId: 'u1', eventId: 'e1' } }, data: { status: 'approved', joinedAt: expect.any(Date) } })
  })
})

describe('31. participants pages say "waitlisted" when that is what happened', () => {
  it.each([
    'app/admin/participants/page.tsx',
    'app/host/events/[id]/participants/page.tsx',
    'app/admin/events/[id]/participants/page.tsx',
  ])('%s handles the waitlisted answer', (file) => {
    const src = read(file)
    expect(src).toContain("status === 'waitlisted'")
    expect(src).toMatch(/moved to the waitlist/)
  })
  it('the admin participants page runs bulk approvals one at a time', () => {
    const src = read('app/admin/participants/page.tsx')
    expect(src).toContain('for (const a of targets) {')
    expect(src).not.toContain('await Promise.all(targets.map(')
  })
})
