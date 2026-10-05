import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({ claimOnce: vi.fn(async () => true), releaseClaim: vi.fn(async () => {}) }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => true) }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/memberPrivacy', () => ({
  blockedIdsFor:    vi.fn(async () => new Set<string>()),
  connectionIdsFor: vi.fn(async () => new Set<string>()),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event:          { findMany: vi.fn() },
    eventAttendee:  { findMany: vi.fn() },
    eventCoHost:    { findMany: vi.fn() },
    user:           { findFirst: vi.fn() },
    eventMeetAgain: { findFirst: vi.fn() },
  },
}))

import { meetAgainPendingFor } from '@/lib/meetAgain'
import { blockedIdsFor, connectionIdsFor } from '@/lib/memberPrivacy'
import { prisma } from '@/lib/prisma'

const p = prisma as any
const DAY = 86_400_000
const isoDay = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
const event = (over: Record<string, unknown> = {}) => ({
  id: 'e1', title: 'Film Night', emoji: '🎬', date: isoDay(-2), time: '19:00', endTime: '21:00',
  hostId: 'host', city: { timezone: 'Europe/Istanbul' }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  ;(blockedIdsFor as any).mockResolvedValue(new Set())
  ;(connectionIdsFor as any).mockResolvedValue(new Set())
  p.event.findMany.mockResolvedValue([event()])
  p.eventAttendee.findMany.mockResolvedValue(['me', 'a', 'b'].map(userId => ({ userId })))
  p.eventCoHost.findMany.mockResolvedValue([])
  p.user.findFirst.mockResolvedValue({ id: 'host' })
  p.eventMeetAgain.findFirst.mockResolvedValue(null)
})

describe('meetAgainPendingFor (dashboard card)', () => {
  it('offers the event, counting the people the picker would list', async () => {
    expect(await meetAgainPendingFor('me')).toEqual({ id: 'e1', title: 'Film Night', emoji: '🎬', people: 3 })
  })

  it('leaves out blocked and already-connected people from the count', async () => {
    ;(blockedIdsFor as any).mockResolvedValue(new Set(['a']))
    ;(connectionIdsFor as any).mockResolvedValue(new Set(['b']))
    expect((await meetAgainPendingFor('me'))?.people).toBe(1) // just the host
  })

  it('asks nothing once everyone left is blocked or connected', async () => {
    ;(connectionIdsFor as any).mockResolvedValue(new Set(['a', 'b', 'host']))
    expect(await meetAgainPendingFor('me')).toBeNull()
  })

  it('asks nothing when the viewer was not in the room (stealth / no-show / excused)', async () => {
    p.eventAttendee.findMany.mockResolvedValue(['a', 'b'].map(userId => ({ userId })))
    expect(await meetAgainPendingFor('me')).toBeNull()
  })

  it('asks nothing after the viewer has made a pick', async () => {
    p.eventMeetAgain.findFirst.mockResolvedValue({ id: 'm1' })
    expect(await meetAgainPendingFor('me')).toBeNull()
  })

  it('asks nothing before the event ends or after the 7-day window', async () => {
    p.event.findMany.mockResolvedValue([event({ date: isoDay(2) })])
    expect(await meetAgainPendingFor('me')).toBeNull()
    p.event.findMany.mockResolvedValue([event({ date: isoDay(-8) })])
    expect(await meetAgainPendingFor('me')).toBeNull()
  })

  it('falls through to an older event when the newest has nothing to ask', async () => {
    p.event.findMany.mockResolvedValue([event({ id: 'new' }), event({ id: 'old', title: 'Picnic' })])
    p.eventMeetAgain.findFirst.mockImplementation(async ({ where }: any) => where.eventId === 'new' ? { id: 'm' } : null)
    expect((await meetAgainPendingFor('me'))?.id).toBe('old')
  })

  it('only asks the database about events that happened', async () => {
    await meetAgainPendingFor('me')
    expect(p.event.findMany.mock.calls[0][0].where).toMatchObject({ cancelledAt: null, status: { in: ['published', 'archived'] } })
  })
})
