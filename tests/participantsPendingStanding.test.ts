import { describe, it, expect, vi, beforeEach } from 'vitest'

// A member's standing is private. The participants payload must surface it in
// exactly one place — the pending rows a host is deciding on — and nowhere
// else: not on approved rows, not on the waitlist.
//
// This guarded the same rule for v1's card counts until that table stopped
// being written. Standing is the source now; the shape of the rule did not
// change, only where the level comes from.

// Edits and invitations are rate-limited and claimed (rate_limits table).
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true), releaseClaim: vi.fn(async () => {}) }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({ isAdmin: vi.fn(), isClubHost: vi.fn(), canManageEventOps: vi.fn().mockResolvedValue(true), hostCityIds: vi.fn(async () => []) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/email',   () => ({ sendEventApprovedEmail: vi.fn(), sendEventRejectedEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn() }))
vi.mock('@/lib/spotsLeft',    () => ({ recomputeSpotsLeft: vi.fn() }))
vi.mock('@/lib/audit',        () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/eventQuota',   () => ({ findPromotableFromWaitlist: vi.fn(), hasQuotaRoomFor: vi.fn(), quotaEventSelect: {} }))
vi.mock('@/lib/standingRead', () => ({ standingLevelsFor: vi.fn(), redCardBlocksSeat: vi.fn(async () => false) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  eventAttendee: { findMany: vi.fn() },
  waitlistEntry: { findMany: vi.fn().mockResolvedValue([]) },
  eventCoHost:   { findMany: vi.fn().mockResolvedValue([]) },
  event:         { findUnique: vi.fn().mockResolvedValue({ hostId: 'h1' }) },
  payment:       { findMany: vi.fn().mockResolvedValue([]) },
  notification:  { findMany: vi.fn() },
  user:          { findMany: vi.fn().mockResolvedValue([]) },
} }))

import { GET } from '@/app/api/admin/events/[id]/participants/route'
import { getSession } from '@/lib/session'
import { standingLevelsFor } from '@/lib/standingRead'
import { prisma } from '@/lib/prisma'

const params = { params: Promise.resolve({ id: 'e1' }) }
const p = prisma as any
const user = (id: string) => ({ id, name: id, color: 'c', email: `${id}@x` })
const get = () => GET(new Request('https://x/app/api/admin/events/e1/participants') as any, params)

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'h1', name: 'Host', role: 'host' })
  ;(standingLevelsFor as any).mockResolvedValue(new Map([['pending-yellow', 'yellow']]))
  p.notification.findMany.mockResolvedValue([])
  p.eventAttendee.findMany.mockResolvedValue([
    { userId: 'pending-yellow',  status: 'pending',  checkedIn: false, joinedAt: 'j', user: user('pending-yellow') },
    { userId: 'pending-clean',   status: 'pending',  checkedIn: false, joinedAt: 'j', user: user('pending-clean') },
    { userId: 'approved-yellow', status: 'approved', checkedIn: false, joinedAt: 'j', user: user('approved-yellow') },
  ])
})

describe('participants GET — standing on pending rows only', () => {
  it('marks a pending member’s level and leaves everyone else unmarked', async () => {
    const body = await (await get()).json()
    const byId = Object.fromEntries(body.attendees.map((a: any) => [a.userId, a]))
    expect(byId['pending-yellow'].standing).toBe('yellow')
    expect(byId['pending-clean'].standing).toBeNull()
    // An approved member at the same level gets no marker at all.
    expect(byId['approved-yellow'].standing).toBeUndefined()
  })

  it('asks only about pending members', async () => {
    await get()
    expect(((standingLevelsFor as any).mock.calls[0][0] as string[]).sort())
      .toEqual(['pending-clean', 'pending-yellow'])
  })

  it('reports who standing already warned, so Notify counts only who it would reach', async () => {
    p.notification.findMany.mockResolvedValue([{ userId: 'm1', createdAt: new Date('2026-09-19T06:00:00Z') }])
    const body = await (await get()).json()
    expect(body.warned).toEqual([{ userId: 'm1', notifiedAt: '2026-09-19T06:00:00.000Z' }])
    const where = p.notification.findMany.mock.calls[0][0].where
    expect(where.type).toBe('attendance_check')
    expect(where.link.contains).toBe('e1')
  })
})
