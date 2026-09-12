import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn() }))
vi.mock('@/lib/push',      () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/city',      () => ({ getCityTz: vi.fn().mockResolvedValue('Europe/Istanbul') }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  club:           { findUnique: vi.fn().mockResolvedValue({ name: 'Runners' }) },
  clubMembership: { findMany: vi.fn().mockResolvedValue([{ userId: 'm1' }, { userId: 'm2' }]) },
  // createNotification (real lib/notify) reads the member's preferences first;
  // without these every create threw inside its own try and nothing was sent.
  notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
  notification:   { count: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'n' }) },
  user:           { findUnique: vi.fn().mockResolvedValue({ notificationPrefs: null, quietHours: null, cityId: 'c1' }) },
} }))

import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rateLimit'
import { notifyNewEvent } from '@/lib/notify'

// The once-per-event guard counted notifications by type+link — a full-table
// scan on every publish (neither column is indexed) and a read-then-write
// that let two concurrent publishes both fan out. It is now one atomic
// DB-backed claim keyed on the event id.

const p = prisma as any

beforeEach(() => vi.clearAllMocks())

describe('notifyNewEvent', () => {
  it('claims the announcement atomically and never scans the notifications table', async () => {
    ;(rateLimit as any).mockResolvedValue(true)
    await notifyNewEvent({ id: 'e1', title: 'Run', clubId: 'c1', hostId: 'h' })
    expect(rateLimit).toHaveBeenCalledWith('new-event-announce:e1', 1, expect.any(Number))
    expect(p.notification.count).not.toHaveBeenCalled()
    expect(p.clubMembership.findMany).toHaveBeenCalled()
    const recipients = p.notification.create.mock.calls.map((c: any[]) => c[0].data)
    expect(recipients.map((d: any) => d.userId)).toEqual(['m1', 'm2'])
    for (const d of recipients) expect(d).toMatchObject({ type: 'new_event', link: '/events/e1' })
  })

  it('a second caller that loses the claim sends nothing', async () => {
    ;(rateLimit as any).mockResolvedValue(false)
    await notifyNewEvent({ id: 'e1', title: 'Run', clubId: 'c1', hostId: 'h' })
    expect(p.clubMembership.findMany).not.toHaveBeenCalled()
    expect(p.notification.create).not.toHaveBeenCalled()
  })

  it('ignores events with no club', async () => {
    await notifyNewEvent({ id: 'e1', title: 'Run', clubId: null, hostId: 'h' })
    expect(rateLimit).not.toHaveBeenCalled()
  })
})
