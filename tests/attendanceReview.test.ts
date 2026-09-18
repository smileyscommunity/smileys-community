import { describe, it, expect, vi, beforeEach } from 'vitest'

// The review queue is the screen that exists to show what the sweep hides, so
// the tests are about exactly that: the ratio against the bar, who was really
// warned (the notification, never the claim), and the scoping that must not
// hand a host somebody else's room.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
  isAdmin:            (s: any) => s?.role === 'admin',
  failClosedCityId:   (s: any) => s?.cityId ?? '__no_city__',
}))
vi.mock('@/lib/standing', () => ({
  standingEvents: vi.fn(),
  roomOf:         vi.fn(),
  reviewSentKey:  (id: string) => `attendance-review-sent:${id}`,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  user:          { findMany: vi.fn(async () => [{ id: 'h1', name: 'Roberta' }]) },
  event:         { findMany: vi.fn(async () => [{ id: 'e1', emoji: '☕' }]) },
  notification:  { findMany: vi.fn(async () => []) },
  rateLimit:     { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
  eventCoHost:   { findMany: vi.fn(async () => []) },
  clubMembership:{ findMany: vi.fn(async () => []) },
} }))

import { attendanceReviewRows } from '@/lib/attendanceReview'
import { GET } from '@/app/api/attendance-review/route'
import { standingEvents, roomOf } from '@/lib/standing'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const p = prisma as any
// 2026-09-17 19:00 Istanbul, read on the morning after: its review is open.
const EVENT = {
  id: 'e1', title: 'Caffè & Conversazione', date: '2026-09-17', time: '19:00', endTime: null,
  limitedSpots: true, totalSpots: 10, tierOverride: null, cancelCutoffHours: null,
  hostId: 'h1', cityId: 'c1', city: { timezone: 'Europe/Istanbul', createdAt: new Date('2025-01-01') },
  cohosts: [], club: null,
}
const guest = (id: string, checkedIn: boolean, name: string) => ({
  id: `a-${id}`, userId: id, checkedIn, attendance: 'unknown', exempt: false,
  user: { name, email: `${id}@x.com`, role: 'member' },
})
const NOW = new Date('2026-09-18T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  ;(standingEvents as any).mockResolvedValue([EVENT])
  p.user.findMany.mockResolvedValue([{ id: 'h1', name: 'Roberta' }])
  p.event.findMany.mockResolvedValue([{ id: 'e1', emoji: '☕' }])
  p.notification.findMany.mockResolvedValue([])
  p.rateLimit.findMany.mockResolvedValue([])
  p.rateLimit.findUnique.mockResolvedValue(null)
})

describe('attendanceReviewRows', () => {
  it('reports the ratio and that the door did not clear the bar', async () => {
    ;(roomOf as any).mockResolvedValue([guest('u1', true, 'A'), guest('u2', false, 'B'), guest('u3', false, 'C')])
    const [row] = await attendanceReviewRows(NOW)
    expect(row.room).toBe(3)
    expect(row.scanned).toBe(1)
    expect(row.ratio).toBeCloseTo(1 / 3)
    expect(row.checkInRan).toBe(false)     // 33% is under the 70% bar
    expect(row.unmarked).toHaveLength(2)
    expect(row.stage).toBe('review')
  })

  it('counts a guest as warned only when the notification exists, never the claim', async () => {
    ;(roomOf as any).mockResolvedValue([guest('u1', true, 'A'), guest('u2', true, 'B'), guest('u3', false, 'Ahmet')])
    // The claim was taken for u3 and burned on a skip path — no notification.
    p.rateLimit.findMany.mockResolvedValue([{ key: 'attendance-review-guest:e1:u3' }])
    p.notification.findMany.mockResolvedValue([])
    const [row] = await attendanceReviewRows(NOW)
    expect(row.unmarked.map(g => [g.name, g.warned])).toEqual([['Ahmet', false]])
  })

  it('narrows to the events it was given', async () => {
    ;(roomOf as any).mockResolvedValue([guest('u1', true, 'A')])
    expect(await attendanceReviewRows(NOW, ['other'])).toEqual([])
    expect(await attendanceReviewRows(NOW, ['e1'])).toHaveLength(1)
  })
})

describe('GET /api/attendance-review', () => {
  it('refuses a signed-out reader', async () => {
    ;(getSession as any).mockResolvedValue(null)
    expect((await GET({} as any)).status).toBe(401)
  })

  it('returns nothing — never everything — to a host who runs no events', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'u9', role: 'member' })
    p.eventCoHost.findMany.mockResolvedValue([])
    p.clubMembership.findMany.mockResolvedValue([])
    p.event.findMany.mockResolvedValue([])          // hosts nothing
    const body = await (await GET({} as any)).json()
    expect(body).toEqual({ rows: [], scope: 'mine' })
    expect(standingEvents).not.toHaveBeenCalled()
  })

  it('gives an admin every room', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'a1', role: 'admin' })
    ;(roomOf as any).mockResolvedValue([guest('u1', true, 'A'), guest('u2', false, 'B')])
    const body = await (await GET({} as any)).json()
    expect(body.scope).toBe('all')
    expect(body.rows).toHaveLength(1)
  })
})
