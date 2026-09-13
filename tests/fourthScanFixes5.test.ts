import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan-4 items 18–23 and 25. Behaviour where it can be exercised directly,
// source pins where the fix is wiring inside a route.

const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => ({
  event:         { findUnique: vi.fn() },
  eventAttendee: { findUnique: vi.fn() },
  noShowCard:    { findFirst: vi.fn(async () => null) },
  review:        { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}))
const session = vi.hoisted(() => ({ current: { id: 'u1', name: 'Ada' } as { id: string; name: string } | null }))
const limits  = vi.hoisted(() => ({ allow: true }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/city', () => ({ todayInCity: vi.fn(async () => '2026-09-13') }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => limits.allow), claimOnce: vi.fn(async () => true) }))

import { fromWallClockInTz, wallClockInTz, todayInTz } from '@/lib/cityTime'
import { eventPhase } from '@/lib/eventTime'
import { awaitingCheckIn, type CheckInPromptEvent } from '@/lib/checkInPrompt'
import { POST as reviewPOST, PATCH as reviewPATCH } from '@/app/api/events/[id]/reviews/route'

describe('DST: wall clock to instant (item 18)', () => {
  it('a New York spring-forward gap lands just after the jump, not an hour before it', () => {
    const d = fromWallClockInTz('2026-03-08T02:30', 'America/New_York')
    expect(wallClockInTz(d, 'America/New_York')).toBe('2026-03-08T03:30')
  })
  it("Santiago's midnight change keeps 00:00 on its own calendar day", () => {
    const d = fromWallClockInTz('2026-09-06T00:00', 'America/Santiago')
    expect(wallClockInTz(d, 'America/Santiago').slice(0, 10)).toBe('2026-09-06')
  })
  it('the Athens gap still resolves forward, and a no-DST zone is untouched', () => {
    expect(wallClockInTz(fromWallClockInTz('2026-03-29T03:30', 'Europe/Athens'), 'Europe/Athens')).toBe('2026-03-29T04:30')
    expect(fromWallClockInTz('2026-03-29T03:30', 'Europe/Istanbul').toISOString()).toBe('2026-03-29T00:30:00.000Z')
  })
  it('a fall-back hour that happens twice takes the first occurrence', () => {
    expect(fromWallClockInTz('2026-11-01T01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })
  it('an impossible date is an invalid date, not a throw', () => {
    expect(Number.isNaN(fromWallClockInTz('2026-13-45T99:99', 'Europe/Athens').getTime())).toBe(true)
  })
})

describe('DST: today plus n days (item 18)', () => {
  afterEach(() => { vi.useRealTimers() })
  it("doesn't repeat a date on Berlin's fall-back morning", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T22:30:00Z'))   // 00:30 CEST on the 25th
    expect(todayInTz('Europe/Berlin')).toBe('2026-10-25')
    expect(todayInTz('Europe/Berlin', 1)).toBe('2026-10-26')
  })
  it("doesn't skip a date the night before Berlin's spring-forward", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-28T22:30:00Z'))   // 23:30 CET on the 28th
    expect(todayInTz('Europe/Berlin', 1)).toBe('2026-03-29')
    expect(todayInTz('Europe/Berlin', -1)).toBe('2026-03-27')
  })
})

describe('a TBA event has no phase (item 19)', () => {
  const tba = { date: '2026-09-12', time: 'TBA', endTime: null }
  it('is neither "soon" the evening before nor "live" all day', () => {
    expect(eventPhase(tba, 'Europe/Istanbul', new Date('2026-09-11T20:30:00Z'))).toBeNull()
    expect(eventPhase(tba, 'Europe/Istanbul', new Date('2026-09-12T09:00:00Z'))).toBeNull()
    expect(eventPhase({ ...tba, time: '' }, 'Europe/Istanbul', new Date('2026-09-12T09:00:00Z'))).toBeNull()
  })
})

describe('check-in prompt counts the room the sweeper counts (item 20)', () => {
  const now = new Date('2026-09-12T18:00:00Z')
  const ev = (over: Partial<CheckInPromptEvent>): CheckInPromptEvent => ({
    id: 'e1', title: 'Coworking', emoji: '💻', date: '2026-09-12', time: '12:00', endTime: '14:00',
    status: 'published', price: 0, memberPrice: null, noShowProcessedAt: null, ...over,
  })
  it('host + one guest scanned of four approved is 1 of 3 guests: still prompted', () => {
    const e = ev({ _count: { attendees: 4 }, checkedInCount: 2, roomApproved: 3, roomCheckedIn: 1 })
    const [pending] = awaitingCheckIn([e], 'Europe/Istanbul', now)
    expect(pending).toMatchObject({ approved: 3, checked: 1 })
  })
  it('falls back to the raw counts for a payload without room fields', () => {
    expect(awaitingCheckIn([ev({ _count: { attendees: 4 }, checkedInCount: 2 })], 'Europe/Istanbul', now)).toEqual([])
  })
  it('the host events API derives the room without host and co-hosts', () => {
    const src = read('app/api/host/events/route.ts')
    expect(src).toMatch(/const staff = new Set\(\[hostId, \.\.\.cohosts\.map\(c => c\.userId\)\]\)/)
    expect(src).toMatch(/roomCheckedIn:\s*room\.filter\(a => a\.checkedIn\)\.length/)
  })
})

describe('once-only broadcasts and reports claim in rate_limits (item 21)', () => {
  it('doors-open is claimed per event, not counted from notifications', () => {
    const src = read('app/api/events/[id]/checkin/route.ts')
    expect(src).toContain("if (checkedInCount <= 2 && await claimOnce(`checkin-started:${eventId}`")
    expect(src).not.toContain('prisma.notification.count')
  })
  it.each([
    ['app/api/board/[id]/report/route.ts',                          'report-board',   'boardPostId'],
    ['app/api/listings/[id]/report/route.ts',                       'report-listing', 'listingId'],
    ['app/api/neighborhoods/[slug]/posts/[postId]/report/route.ts', 'report-wall',    'postId'],
  ])('%s claims the (reporter, target) pair before creating the report', (file, key, idVar) => {
    const src = read(file)
    const claim  = src.indexOf(`claimOnce(\`${key}:\${session.id}:\${${idVar}}\``)
    const create = src.indexOf('prisma.report.create(')
    expect(claim).toBeGreaterThan(-1)
    expect(claim).toBeLessThan(create)
  })
})

describe('unbounded tables (item 22)', () => {
  it('the nightly sweep prunes dead sessions and duplicate unstamped recommendations', () => {
    const src = read('app/api/cron/sweep-event-spots/route.ts')
    expect(src).toMatch(/prisma\.session\.deleteMany\(\{\s*where: \{ OR: \[\{ expiresAt: \{ lt: dayAgo \} \}, \{ revokedAt: \{ lt: dayAgo \} \}\] \}/)
    expect(src).toMatch(/DELETE FROM event_recommendations r\s+WHERE r\."clickedAt" IS NULL AND r\."rsvpedAt" IS NULL/)
    // The earliest row per (member, event) survives: the funnel's first showing.
    expect(src).toMatch(/e\."createdAt" < r\."createdAt" OR \(e\."createdAt" = r\."createdAt" AND e\.id < r\.id\)/)
  })
  it('the first-event block logs a card at most once a day per member', () => {
    const src = read('app/api/first-event/route.ts')
    expect(src).toMatch(/createdAt: \{ gte: since \}/)
    expect(src).toMatch(/if \(fresh\.length\) await prisma\.eventRecommendation\.createMany/)
  })
  it('getSession stamps lastUsedAt at most every five minutes', () => {
    const src = read('lib/session.ts')
    expect(src).toMatch(/Date\.now\(\) - sessionRow\.lastUsedAt\.getTime\(\) > LAST_USED_EVERY_MS/)
    expect(src).toContain('const LAST_USED_EVERY_MS = 5 * 60_000')
  })
})

describe('push prompt tells the truth about a refused subscription (item 23)', () => {
  const src = read('components/PushPermission.tsx')
  it('only reports subscribed on success, and says why otherwise', () => {
    expect(src).toMatch(/if \(result === 'ok'\) \{\s*writeStamp\(SYNCED_KEY\)\s*setState\('subscribed'\)/)
    expect(src).toContain('toast.error(')
    expect(src).not.toMatch(/if \(ok\) writeStamp\(SYNCED_KEY\)\s*setState\('subscribed'\)/)
  })
  it('backs off a refused endpoint instead of re-posting it daily', () => {
    expect(src).toMatch(/Date\.now\(\) - readStamp\(REFUSED_KEY\) > REFUSED_FOR/)
    expect(src).toMatch(/res\.status === 400 \? 'refused'/)
  })
})

describe('event reviews (item 25)', () => {
  const call = (handler: typeof reviewPOST, body: unknown) =>
    handler(new Request('http://x/api/events/e1/reviews', { method: 'POST', body: JSON.stringify(body) }) as never,
      { params: Promise.resolve({ id: 'e1' }) })

  beforeEach(() => {
    vi.clearAllMocks()
    session.current = { id: 'u1', name: 'Ada' }
    limits.allow = true
    p.event.findUnique.mockResolvedValue({ id: 'e1', cityId: 'c1', date: '2026-09-01' })
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved', attendance: 'attended' })
    p.review.findUnique.mockResolvedValue(null)
    p.review.create.mockResolvedValue({ id: 'r1' })
  })

  it.each([['3'], [4.5], [0], [6], [null]])('POST rejects rating %p without writing', async (rating) => {
    const res = await call(reviewPOST, { rating })
    expect(res.status).toBe(400)
    expect(p.review.create).not.toHaveBeenCalled()
  })
  it('POST rejects non-string text instead of throwing', async () => {
    const res = await call(reviewPOST, { rating: 4, text: 123 })
    expect(res.status).toBe(400)
  })
  it('a settled no-show cannot review the event', async () => {
    p.eventAttendee.findUnique.mockResolvedValue({ status: 'approved', attendance: 'no_show' })
    const res = await call(reviewPOST, { rating: 5 })
    expect(res.status).toBe(403)
    expect(p.review.create).not.toHaveBeenCalled()
  })
  it('an attendee can review', async () => {
    const res = await call(reviewPOST, { rating: 5, text: ' Great night ' })
    expect(res.status).toBe(200)
    expect(p.review.create.mock.calls[0][0].data).toMatchObject({ rating: 5, text: 'Great night' })
  })
  it('writes are rate limited', async () => {
    limits.allow = false
    expect((await call(reviewPOST, { rating: 5 })).status).toBe(429)
    expect((await call(reviewPATCH, { rating: 5 })).status).toBe(429)
  })
  it('PATCH rejects a non-numeric rating and non-string text', async () => {
    p.review.findUnique.mockResolvedValue({ id: 'r1' })
    expect((await call(reviewPATCH, { rating: 'abc' })).status).toBe(400)
    expect((await call(reviewPATCH, { text: null })).status).toBe(400)
    expect(p.review.update).not.toHaveBeenCalled()
  })
})
