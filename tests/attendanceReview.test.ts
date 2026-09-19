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
  reviewSentKey:  (id: string) => `attendance-review-sent:${id}`,
}))
vi.mock('@/lib/noShowPolicy', () => ({
  noShowExemptionReason: () => null,
  eventRunners: () => ({ hostId: 'h1', cohostIds: [], clubHostIds: [] }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  user:          { findMany: vi.fn(async () => [{ id: 'h1', name: 'Roberta' }]) },
  eventAttendee: { findMany: vi.fn(async () => []) },
  event:         { findMany: vi.fn(async () => [{ id: 'e1', emoji: '☕' }]) },
  notification:  { findMany: vi.fn(async () => []) },
  rateLimit:     { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
  eventCoHost:   { findMany: vi.fn(async () => []) },
  clubMembership:{ findMany: vi.fn(async () => []) },
} }))

import { attendanceReviewRows } from '@/lib/attendanceReview'
import { GET } from '@/app/api/attendance-review/route'
import { standingEvents } from '@/lib/standing'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const p = prisma as any
// The route reads ?settled; a real NextRequest always carries nextUrl.
const req = (qs = '') => ({ nextUrl: { searchParams: new URLSearchParams(qs) } })
// 2026-09-17 19:00 Istanbul, read on the morning after: its review is open.
const EVENT = {
  id: 'e1', title: 'Caffè & Conversazione', date: '2026-09-17', time: '19:00', endTime: null,
  limitedSpots: true, totalSpots: 10, tierOverride: null, cancelCutoffHours: null,
  hostId: 'h1', cityId: 'c1', city: { timezone: 'Europe/Istanbul', createdAt: new Date('2025-01-01') },
  cohosts: [], club: null,
}
// An approved row as the batched read returns it — one findMany for the page,
// so every row carries the event it belongs to.
const guest = (id: string, checkedIn: boolean, name: string, eventId = 'e1') => ({
  id: `a-${id}`, eventId, userId: id, checkedIn, attendance: 'unknown',
  user: { name, role: 'member' },
})
const room = (...g: ReturnType<typeof guest>[]) => p.eventAttendee.findMany.mockResolvedValue(g)
const NOW = new Date('2026-09-18T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  ;(standingEvents as any).mockResolvedValue([EVENT])
  p.user.findMany.mockResolvedValue([{ id: 'h1', name: 'Roberta' }])
  p.event.findMany.mockResolvedValue([{ id: 'e1', emoji: '☕' }])
  p.notification.findMany.mockResolvedValue([])
  p.rateLimit.findMany.mockResolvedValue([])
  p.eventAttendee.findMany.mockResolvedValue([])
})

describe('attendanceReviewRows', () => {
  it('reports the ratio and that the door did not clear the bar', async () => {
    room(guest('u1', true, 'A'), guest('u2', false, 'B'), guest('u3', false, 'C'))
    const { rows: [row] } = await attendanceReviewRows(NOW)
    expect(row.room).toBe(3)
    expect(row.scanned).toBe(1)
    expect(row.ratio).toBeCloseTo(1 / 3)
    expect(row.checkInRan).toBe(false)     // 33% is under the 70% bar
    expect(row.unmarked).toHaveLength(2)
    expect(row.stage).toBe('review')
  })

  it('counts a guest as warned only when the notification exists, never the claim', async () => {
    room(guest('u1', true, 'A'), guest('u2', true, 'B'), guest('u3', false, 'Ahmet'))
    // The claim was taken for u3 and burned on a skip path — no notification.
    p.rateLimit.findMany.mockResolvedValue([{ key: 'attendance-review-guest:e1:u3' }])
    p.notification.findMany.mockResolvedValue([])
    const { rows: [row] } = await attendanceReviewRows(NOW)
    expect(row.unmarked.map(g => [g.name, g.warned])).toEqual([['Ahmet', false]])
  })

  it('narrows to the events it was given', async () => {
    room(guest('u1', true, 'A'))
    expect((await attendanceReviewRows(NOW, ['other'])).rows).toEqual([])
    expect((await attendanceReviewRows(NOW, ['e1'])).rows).toHaveLength(1)
  })
})

describe('GET /api/attendance-review', () => {
  it('refuses a signed-out reader', async () => {
    ;(getSession as any).mockResolvedValue(null)
    expect((await GET(req() as any)).status).toBe(401)
  })

  it('returns nothing — never everything — to a host who runs no events', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'u9', role: 'member' })
    p.eventCoHost.findMany.mockResolvedValue([])
    p.clubMembership.findMany.mockResolvedValue([])
    p.event.findMany.mockResolvedValue([])          // hosts nothing
    const body = await (await GET(req() as any)).json()
    expect(body).toMatchObject({ rows: [], total: 0, scope: 'mine' })
    expect(standingEvents).not.toHaveBeenCalled()
  })

  it('gives an admin every room', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'a1', role: 'admin' })
    room(guest('u1', true, 'A'), guest('u2', false, 'B'))
    const body = await (await GET(req() as any)).json()
    expect(body.scope).toBe('all')
    expect(body.rows).toHaveLength(1)
  })
})

describe('the queue does not degrade as the community runs more events', () => {
  const ev = (id: string, date: string) => ({ ...EVENT, id, date })

  it('reads a fixed number of queries whatever the page length', async () => {
    // One findMany each for hosts, emojis, attendees, warnings and claims —
    // five, for ten events or for one. It used to be four PER EVENT, so a
    // month of them was hundreds of round trips for a single page load.
    ;(standingEvents as any).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ev(`e${i}`, '2026-09-17')))
    room(guest('u1', true, 'A'))
    await attendanceReviewRows(NOW)
    expect(p.eventAttendee.findMany).toHaveBeenCalledTimes(1)
    expect(p.notification.findMany).toHaveBeenCalledTimes(1)
    expect(p.rateLimit.findMany).toHaveBeenCalledTimes(1)
    expect(p.event.findMany).toHaveBeenCalledTimes(1)
  })

  it('leaves long-settled rooms out by default, and still reports how many there are', async () => {
    // Read in October, so DEFAULT_ABSENT_FIRST_REVIEW_DAY — the launch floor
    // that pins every pre-18-September event to one review day — is long past
    // and each room settles on its own date.
    const OCT = new Date('2026-10-10T12:00:00Z')
    ;(standingEvents as any).mockResolvedValue([ev('recent', '2026-10-09'), ev('old', '2026-09-20')])
    room(guest('u1', false, 'A'))
    const fresh = await attendanceReviewRows(OCT)
    expect(fresh.rows.map(r => r.eventId)).toEqual(['recent'])
    expect(fresh.total).toBe(2)

    const all = await attendanceReviewRows(OCT, undefined, undefined, { includeSettled: true })
    expect(all.rows).toHaveLength(2)
  })

  it('caps one response and never lets the cap hide the true count', async () => {
    ;(standingEvents as any).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ev(`e${i}`, '2026-09-17')))
    room(guest('u1', false, 'A'))
    const { rows, total } = await attendanceReviewRows(NOW, undefined, undefined, { limit: 5 })
    expect(rows).toHaveLength(5)
    expect(total).toBe(12)
  })
})
