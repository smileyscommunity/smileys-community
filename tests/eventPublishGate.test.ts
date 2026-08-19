import { describe, it, expect, vi, beforeEach } from 'vitest'

// A club host's own new events are forced to 'pending' at creation so staff
// review them before they reach the public feed and fan out to members. The
// event edit route (PUT) accepted 'status' from every caller, so a host could
// create an event (→ pending) then immediately PUT {status:'published'} on it
// and skip the queue — publishing to the whole city unreviewed, notifications
// and all. This pins the block: a host cannot TRANSITION an unpublished event
// into published, but every other status move on their own event still works,
// and editing an already-published event is untouched.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access', () => ({
  isAdmin:            (s: any) => s?.role === 'admin',
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
  isClubHost:         vi.fn(async () => true),
  isClubHostFor:      vi.fn(async () => true),
}))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(() => Promise.resolve()), notifyNewEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/audit',  () => ({ writeAudit: vi.fn(), getDiff: vi.fn(() => null) }))
vi.mock('@/lib/email',  () => ({ sendEventCancelledEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: { findUnique: vi.fn(), update: vi.fn(async ({ data }: any) => ({ id: 'e1', ...data })), updateMany: vi.fn() },
    eventAttendee: { findMany: vi.fn(async () => []) },
  },
}))

import { PUT } from '@/app/api/admin/events/[id]/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const host = { id: 'h1', name: 'Host', role: 'member', cityId: 'c1' }
const params = { params: Promise.resolve({ id: 'e1' }) } as never

function put(body: unknown) {
  return PUT(new NextRequestLike(body) as never, params)
}
// The route only reads req.json(); a minimal stand-in avoids constructing a
// full NextRequest.
class NextRequestLike {
  constructor(private body: unknown) {}
  async json() { return this.body }
}

// The host owns the event (hostId === session.id) in every case here — the
// question is purely the status transition, not ownership.
function existing(status: string) {
  return {
    hostId: 'h1', clubId: 'club1', cityId: 'c1', date: '2026-09-01', time: '19:00',
    location: 'x', title: 'T', neighborhood: 'x', price: null, memberPrice: null,
    totalSpots: 10, emoji: '🎉', isPremium: false, membersOnly: false,
    limitedSpots: false, isFirstTimerFriendly: false, status, seriesId: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(host)
})

describe('club host cannot publish past the review queue', () => {
  it('blocks pending → published', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(existing('pending'))
    const res = await put({ status: 'published' })
    expect(res.status).toBe(403)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it('blocks draft → published too', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(existing('draft'))
    const res = await put({ status: 'published' })
    expect(res.status).toBe(403)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it('allows a host to cancel their own event', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(existing('published'))
    const res = await put({ status: 'cancelled' })
    expect(res.status).toBe(200)
  })

  it('allows editing an already-published event (no-op status resubmit)', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(existing('published'))
    const res = await put({ status: 'published', title: 'New title' })
    expect(res.status).toBe(200)
  })

  it('an admin can still publish anything', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'a1', name: 'A', role: 'admin', cityId: 'c1' })
    ;(prisma.event.findUnique as any).mockResolvedValue(existing('pending'))
    const res = await put({ status: 'published' })
    expect(res.status).toBe(200)
  })
})
