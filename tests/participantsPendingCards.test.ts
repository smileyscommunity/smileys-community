import { describe, it, expect, vi, beforeEach } from 'vitest'

// A yellow card is a private warning. The participants payload must surface
// a member's active cards in exactly one place — the pending rows a host is
// deciding on — as counts, and nowhere else: not on approved rows, not on
// the waitlist, and never for cards that were waived or overturned.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({ isAdmin: vi.fn(), isClubHost: vi.fn(), canManageEventOps: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/email',   () => ({ sendEventApprovedEmail: vi.fn(), sendEventRejectedEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn() }))
vi.mock('@/lib/spotsLeft',    () => ({ recomputeSpotsLeft: vi.fn() }))
vi.mock('@/lib/audit',        () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/eventQuota',   () => ({ findPromotableFromWaitlist: vi.fn(), hasQuotaRoomFor: vi.fn(), quotaEventSelect: {} }))
vi.mock('@/lib/noShow',       () => ({ getRsvpGate: vi.fn(), gateErrorBody: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  eventAttendee: { findMany: vi.fn() },
  waitlistEntry: { findMany: vi.fn().mockResolvedValue([]) },
  eventCoHost:   { findMany: vi.fn().mockResolvedValue([]) },
  event:         { findUnique: vi.fn().mockResolvedValue({ hostId: 'h1' }) },
  payment:       { findMany: vi.fn().mockResolvedValue([]) },
  noShowCard:    { findMany: vi.fn() },
  user:          { findMany: vi.fn().mockResolvedValue([]) },
} }))

import { GET } from '@/app/api/admin/events/[id]/participants/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const params = { params: Promise.resolve({ id: 'e1' }) }
const p = prisma as any
const user = (id: string) => ({ id, name: id, color: 'c', email: `${id}@x` })

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'h1', name: 'Host', role: 'host' })
  p.eventAttendee.findMany.mockResolvedValue([
    { userId: 'pending-yellow', status: 'pending',  checkedIn: false, joinedAt: 'j', user: user('pending-yellow') },
    { userId: 'pending-clean',  status: 'pending',  checkedIn: false, joinedAt: 'j', user: user('pending-clean') },
    { userId: 'approved-yellow', status: 'approved', checkedIn: false, joinedAt: 'j', user: user('approved-yellow') },
  ])
  // First call: this event's own cards (none). Second call: the pending
  // members' active cards across all events.
  p.noShowCard.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ userId: 'pending-yellow', kind: 'yellow' }])
})

describe('participants GET — active cards on pending rows only', () => {
  it('counts a pending member’s active cards and leaves everyone else unmarked', async () => {
    const body = await (await GET(new Request('https://x/app/api/admin/events/e1/participants') as any, params)).json()
    const byId = Object.fromEntries(body.attendees.map((a: any) => [a.userId, a]))
    expect(byId['pending-yellow'].activeCards).toEqual({ yellow: 1, red: 0 })
    expect(byId['pending-clean'].activeCards).toEqual({ yellow: 0, red: 0 })
    // An approved member with the same card gets no marker at all.
    expect(byId['approved-yellow'].activeCards).toBeUndefined()
  })

  it('asks only about pending members, and only for cards that still count', async () => {
    await GET(new Request('https://x/app/api/admin/events/e1/participants') as any, params)
    const lookup = p.noShowCard.findMany.mock.calls[1][0]
    expect(lookup.where.userId.in.sort()).toEqual(['pending-clean', 'pending-yellow'])
    expect(lookup.where.status.in.sort()).toEqual(['active', 'appeal_pending'])
  })
})
