import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Admin panel review (2026-09): queues and the badges that count them, the
// dashboard's numbers, and the lists that hid rows or showed a day early.
// The failures here are quiet — a plausible number, a list one page short, a
// modal that "notified 0 attendees" — so the definitions are pinned directly.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

const h = vi.hoisted(() => {
  const fn = () => vi.fn()
  return {
    getSession: vi.fn(),
    prisma: {
      report:            { findMany: fn(), count: fn() },
      boardPost:         { findMany: fn() },
      listing:           { findMany: fn() },
      neighborhoodPost:  { findMany: fn() },
      event:             { findMany: fn(), count: fn() },
      clubMembership:    { findMany: fn(), groupBy: fn() },
      hangout:           { findMany: fn(), count: fn(), groupBy: fn() },
      memberApplication: { findMany: fn(), count: fn() },
      user:              { count: fn(), findUnique: fn(), findMany: fn() },
      eventAttendee:     { count: fn(), groupBy: fn() },
      eventSurvey:       { count: fn() },
      payment:           { groupBy: fn() },
      hangoutReference:  { count: fn() },
      visitorAnnouncement: { count: fn() },
      emailFailure:      { count: fn() },
      eventMessage:      { findMany: fn() },
      memberBlock:       { groupBy: fn() },
      boardReply:        { findMany: fn() },
      city:              { findUnique: fn() },
    } as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
  }
})

vi.mock('@/lib/prisma',  () => ({ prisma: h.prisma }))
vi.mock('@/lib/session', () => ({ getSession: h.getSession }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/city', () => ({
  getCityTz:     vi.fn(async () => 'Europe/Istanbul'),
  todayInCity:   vi.fn(async () => '2026-09-19'),
  resolveCityId: vi.fn(async () => 'c-ist'),
}))
vi.mock('@/lib/clubRequests', () => ({ countHostlessClubRequests: vi.fn(async () => 0) }))
vi.mock('@/lib/cronHealth',   () => ({ listStaleSweepers: vi.fn(async () => []) }))
vi.mock('@/lib/cityOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cityOps')>()),
  stalledLiveCities: vi.fn(async () => []),
}))
vi.mock('@/lib/postponedEvents', () => ({ loadPostponedEvents: vi.fn(async () => []), planPostponed: () => [] }))

import { reportCityWhere, reportQueueWhere } from '@/lib/admin/reportScope'
import { addMonthsClamped, seriesDates } from '@/lib/seriesDates'
import { COMMUNITY_MEMBER_WHERE } from '@/lib/memberCount'

const p = h.prisma
const admin = { id: 'adm', role: 'admin', cityId: 'c-ist' }
const mod   = { id: 'mod', role: 'moderator', cityId: 'c-bod' }

beforeEach(() => {
  vi.clearAllMocks()
  for (const model of Object.values(p)) {
    for (const [method, f] of Object.entries(model)) {
      if (method === 'count') f.mockResolvedValue(0)
      else if (method === 'findMany' || method === 'groupBy') f.mockResolvedValue([])
      else f.mockResolvedValue(null)
    }
  }
})

// ── Report scope: one filter for the queue and every badge ──────────────────
describe('report scope', () => {
  beforeEach(() => {
    p.report.findMany.mockResolvedValueOnce([
      { boardPostId: 'bp-here', listingId: null, neighborhoodPostId: null },
      { boardPostId: 'bp-away', listingId: null, neighborhoodPostId: null },
      { boardPostId: null, listingId: 'l-here', neighborhoodPostId: null },
      { boardPostId: null, listingId: null, neighborhoodPostId: 'w-gone' },
    ])
    p.boardPost.findMany.mockResolvedValue([{ id: 'bp-here', cityId: 'c-bod' }, { id: 'bp-away', cityId: 'c-ist' }])
    p.listing.findMany.mockResolvedValue([{ id: 'l-here', cityId: 'c-bod' }])
    p.neighborhoodPost.findMany.mockResolvedValue([])   // the wall post was deleted
  })

  it('files board, listing and wall reports under the content city; everything else (and gone content) under the member', async () => {
    const where = await reportCityWhere('c-bod')
    expect(where).toEqual({
      OR: [
        {
          AND: [
            { OR: [{ boardPostId: null },        { boardPostId:        { in: [] } }] },
            { OR: [{ listingId: null },          { listingId:          { in: [] } }] },
            { OR: [{ neighborhoodPostId: null }, { neighborhoodPostId: { in: ['w-gone'] } }] },
          ],
          reported: { is: { cityId: 'c-bod' } },
        },
        { boardPostId:        { in: ['bp-here'] } },
        { listingId:          { in: ['l-here'] } },
        { neighborhoodPostId: { in: [] } },
      ],
    })
  })

  it('a moderator is scoped to their city and never sees reports about themselves', async () => {
    const where = await reportQueueWhere(mod as never)
    expect(where.reportedId).toEqual({ not: 'mod' })
    expect(JSON.stringify(where)).toContain('c-bod')
  })

  it('a moderator with no city fails closed', async () => {
    const where = await reportQueueWhere({ ...mod, cityId: null } as never)
    expect(JSON.stringify(where)).toContain('__no_city__')
  })

  it('an admin sees every city unless one is asked for — but still not reports about themselves', async () => {
    expect(await reportQueueWhere(admin as never)).toEqual({ reportedId: { not: 'adm' } })
    expect(p.report.findMany).not.toHaveBeenCalled()
    const scoped = await reportQueueWhere(admin as never, { cityId: 'c-bod' })
    expect(scoped.reportedId).toEqual({ not: 'adm' })
    expect(JSON.stringify(scoped)).toContain('c-bod')
  })

  it('the queue and both badges read the same filter', async () => {
    h.getSession.mockResolvedValue(mod)
    const { GET: queueGET } = await import('@/app/api/admin/moderation/route')
    const { GET: modStatsGET } = await import('@/app/api/admin/mod-stats/route')
    await queueGET()
    // Fresh content lookups for the second call.
    p.report.findMany.mockResolvedValueOnce([])
    await modStatsGET()
    const queueWhere = p.report.findMany.mock.calls.find(c => c[0]?.include)![0].where
    const badgeWhere = p.report.count.mock.calls[0][0].where
    expect(badgeWhere.status).toBe('pending')
    expect(badgeWhere.reportedId).toEqual(queueWhere.reportedId)
    expect(JSON.stringify(badgeWhere)).toContain('c-bod')
    for (const src of ['app/api/admin/moderation/route.ts', 'app/api/admin/mod-stats/route.ts', 'app/api/admin/stats/route.ts']) {
      expect(read(src)).toContain('reportQueueWhere(session')
      expect(read(src)).not.toMatch(/reported: \{ (is: \{ )?cityId/)
    }
  })
})

// ── Event review queue ──────────────────────────────────────────────────────
describe('event review queue', () => {
  it('lists pending events (not approvalRequired ones), city-scoped for a moderator', async () => {
    h.getSession.mockResolvedValue(mod)
    const { GET } = await import('@/app/api/admin/events/approval/route')
    await GET()
    const where = p.event.findMany.mock.calls[0][0].where
    expect(where).toEqual({ status: 'pending', cityId: 'c-bod' })
  })

  it('the pages point at it: badge counts the queue, Mod Home and the topbar link to pending', () => {
    const mod = read('app/admin/moderation/page.tsx')
    expect(mod).toContain("badge: queue.length")
    expect(mod).not.toContain("e.status === 'published').length")
    expect(read('app/admin/moderator/page.tsx')).toContain('href="/admin/moderation?tab=events"')
    expect(read('components/admin/Topbar.tsx')).toContain('href="/admin/events?tab=pending"')
    // Both destination pages read ?tab= on load.
    expect(mod).toContain("searchParams.get('tab')")
    expect(read('app/admin/events/page.tsx')).toContain("searchParams.get('tab')")
  })
})

// ── Events list ─────────────────────────────────────────────────────────────
describe('admin events list', () => {
  const src = read('app/admin/events/page.tsx')
  it('does not open the notify modal after a cancel or postpone — the server already told attendees', () => {
    expect(src).not.toMatch(/openNotify\(\{ \.\.\.updated/)
    expect(src).not.toContain('You can notify attendees in the next step')
    expect(src).toContain('emailed and notified automatically')
  })
  it('bulk actions only touch selected rows that are visible, and changing the view clears the selection', () => {
    expect(src).toContain('const selectedVisible = useMemo(() => visible.filter(e => selected.has(e.id)), [visible, selected])')
    expect(src).toContain('useEffect(() => { setSelected(new Set()) }, [tabStatus, search, clubFilter, cityFilter, dateFrom, dateTo])')
    expect(src).not.toContain('[...selected].map(')
  })
  it('row updates apply to the latest list, not a render-time snapshot', () => {
    expect(src).toContain("setEventsData(prev => typeof next === 'function' ? next(prev ?? []) : next)")
  })
})

// ── Dashboard numbers ───────────────────────────────────────────────────────
describe('dashboard stats', () => {
  const run = async (url = 'https://x/app/api/admin/stats?city=c-bod') => {
    h.getSession.mockResolvedValue(admin)
    const { GET } = await import('@/app/api/admin/stats/route')
    return (await GET(new Request(url))).json()
  }
  beforeEach(() => p.city.findUnique.mockResolvedValue({ id: 'c-bod', name: 'Bodrum', slug: 'bodrum' }))

  it('revenue is per currency: last 30 days against the 30 before, pending as still owed', async () => {
    p.payment.groupBy.mockImplementation(async ({ where }: any) => {
      if (where.status === 'pending') return [{ currency: 'EUR', _sum: { amount: 40 }, _count: { _all: 2 } }]
      if (where.createdAt?.lt) return [{ currency: 'TRY', _sum: { amount: 1000 } }]          // previous window
      return [{ currency: 'TRY', _sum: { amount: 1500 } }, { currency: 'EUR', _sum: { amount: 90 } }]
    })
    const body = await run()
    expect(body.revenue).toEqual([
      { currency: 'TRY', collected: 1500, previous: 1000, trend: 50,  pending: 0 },
      { currency: 'EUR', collected: 90,   previous: 0,    trend: 100, pending: 40 },
    ])
    expect(body.pendingPayments).toBe(2)
    // No window-less paid read: the trend compares like with like.
    const paid = p.payment.groupBy.mock.calls.map(c => c[0].where).filter(w => w.status === 'paid')
    expect(paid).toHaveLength(2)
    for (const w of paid) expect(w.createdAt?.gte).toBeInstanceOf(Date)
    for (const c of p.payment.groupBy.mock.calls) expect(c[0].by).toEqual(['currency'])
  })

  it('upcoming counts published events from today on', async () => {
    await run()
    const wheres = p.event.count.mock.calls.map(c => c[0].where)
    expect(wheres).toContainEqual({ status: 'published', date: { gte: expect.any(String) }, cityId: 'c-bod' })
  })

  it('the funnel follows one cohort: its applications, its approvals, then past attendance in the same city', async () => {
    p.memberApplication.findMany.mockResolvedValue([
      { email: 'a@x', status: 'approved' }, { email: 'b@x', status: 'approved' },
      { email: 'c@x', status: 'rejected' }, { email: 'd@x', status: 'pending' },
    ])
    p.eventAttendee.groupBy.mockImplementation(async ({ where }: any) =>
      where.user?.email ? [{ userId: 'ua', _count: { _all: 3 } }] : [])
    const body = await run()
    expect(body.funnel).toEqual({ windowDays: 90, applications: 4, approved: 2, firstEvent: 1, repeat: 1 })
    const appWhere = p.memberApplication.findMany.mock.calls[0][0].where
    expect(appWhere.targetCityId).toBe('c-bod')
    expect(appWhere.createdAt.gte).toBeInstanceOf(Date)
    const att = p.eventAttendee.groupBy.mock.calls.find(c => c[0].where.user?.email)![0].where
    expect(att.user).toEqual({ email: { in: ['a@x', 'b@x'] } })
    expect(att.OR).toEqual([{ checkedIn: true }, { attendance: 'attended' }])
    expect(att.event).toEqual({ date: { lt: expect.any(String) }, status: { in: ['published', 'archived'] }, cityId: 'c-bod' })
  })

  it('the dashboard renders money per currency and scopes Recent Activity to the city', () => {
    const page = read('app/admin/page.tsx')
    expect(page).not.toContain('revenueCollected')
    expect(page).not.toMatch(/formatMoney\([^)]*, cur\)/)
    // …and without the door taps, which would be the whole strip after a
    // forty-person event (member-card review, 2026-09-20).
    expect(page).toContain('fetch(`/app/api/admin/audit?take=8&exclude=checkin.${cityQ}`')
  })
})

// ── Hosts ───────────────────────────────────────────────────────────────────
describe('hosts list', () => {
  it('lists approved members hosting active clubs, and counts only events that happened', async () => {
    h.getSession.mockResolvedValue(admin)
    p.clubMembership.findMany.mockResolvedValue([
      { userId: 'u1', user: { id: 'u1', name: 'Ada', email: 'a@x', color: '#000' }, club: { id: 'c1', name: 'Run', emoji: '🏃' } },
    ])
    p.event.findMany.mockResolvedValue([
      { hostId: 'u1', date: '2026-09-10', city: { timezone: 'Europe/Istanbul' }, _count: { attendees: 5 } },
      { hostId: 'u1', date: '2026-01-02', city: { timezone: 'Europe/Istanbul' }, _count: { attendees: 2 } },
      // Future: not a "last event" yet.
      { hostId: 'u1', date: '2099-01-01', city: { timezone: 'Europe/Istanbul' }, _count: { attendees: 9 } },
    ])
    const { GET } = await import('@/app/api/admin/hosts/route')
    const { hosts } = await (await GET()).json()
    expect(p.clubMembership.findMany.mock.calls[0][0].where).toEqual({
      role: 'host', status: 'approved', user: { status: 'approved' }, club: { isActive: true },
    })
    expect(p.event.findMany.mock.calls[0][0].where.status).toEqual({ in: ['published', 'archived'] })
    // No `time` in the select: an odd time string can't drop an event.
    expect(p.event.findMany.mock.calls[0][0].select.time).toBeUndefined()
    expect(hosts[0]).toMatchObject({ eventCount: 2, totalAttendees: 7, lastEventDate: '2026-09-10' })
  })
})

// ── Hangouts ────────────────────────────────────────────────────────────────
describe('hangouts oversight order', () => {
  it('live and upcoming first (soonest first), then past (most recent first), paged across both', async () => {
    h.getSession.mockResolvedValue(admin)
    p.hangout.count.mockImplementation(async ({ where }: any) => where.endsAt.gte ? 3 : 10)
    p.hangout.findMany.mockImplementation(async ({ where }: any) =>
      [{ id: where.endsAt.gte ? 'live' : 'past', user: { id: 'u', name: 'N', email: 'e', color: '#000' } }])
    const { GET } = await import('@/app/api/admin/hangouts/route')
    const body = await (await GET(new Request('https://x/api/admin/hangouts?offset=0') as never)).json()
    expect(body.total).toBe(13)
    const calls = p.hangout.findMany.mock.calls.map(c => c[0])
    const live = calls.find(c => c.where.endsAt.gte)!
    const past = calls.find(c => c.where.endsAt.lt)!
    expect(live).toMatchObject({ orderBy: { startsAt: 'asc' },  skip: 0, take: 3 })
    expect(past).toMatchObject({ orderBy: { startsAt: 'desc' }, skip: 0, take: 47 })
    expect(body.hangouts.map((x: any) => x.id)).toEqual(['live', 'past'])

    // A later page skips past the live ones entirely.
    p.hangout.findMany.mockClear()
    await GET(new Request('https://x/api/admin/hangouts?offset=50') as never)
    expect(p.hangout.findMany.mock.calls.map(c => c[0])).toEqual([expect.objectContaining({ skip: 47, take: 50 })])
  })

  it('the list renders times on the hangout city clock', () => {
    const src = read('app/admin/hangouts/page.tsx')
    expect(src).toContain('whenLabel(h.startsAt, h.endsAt, tzFor(h))')
    expect(src).toMatch(/hourCycle: 'h23', timeZone: tz/)
  })
})

// ── Smaller fixes, pinned at the source ─────────────────────────────────────
describe('lists that hid rows', () => {
  it('check-in loads archived events, keeps recent ones and any deep-linked one', () => {
    const src = read('app/admin/checkin/page.tsx')
    expect(src).toContain("fetch('/app/api/admin/events?archived=1'")
    expect(src).toContain("(e.status !== 'archived' || e.date >= recentFloor || e.id === defaultEventId)")
    expect(src).toContain('if (linked.date < today) setShowAllEvents(true)')
    expect(src).not.toContain("'No events today'")
  })
  it('the analytics dormant list follows the city switcher', () => {
    const src = read('app/admin/analytics/page.tsx')
    expect(src).toContain("fetch(`/app/api/admin/retention${cityId ? `?city=${encodeURIComponent(cityId)}` : ''}`")
    expect(src).toContain('}, [tab, cityId, retentionCity])')
  })
  it('the directory searches, filters by city and pages on the server', () => {
    const route = read('app/api/admin/directory/route.ts')
    expect(route).toContain("searchParams.get('q')")
    expect(route).toContain("cursor ? { cursor: { id: cursor }, skip: 1 } : {}")
    const page = read('app/admin/directory/page.tsx')
    expect(page).toContain('&city=${encodeURIComponent(cityFilter)}')
    expect(page).toContain('&cursor=${encodeURIComponent(last.id)}')
    expect(page).not.toContain("allItems.filter(b => (b.city?.slug ?? '') === cityFilter)")
  })
  it('city cards count members by the dashboard rule', () => {
    expect(read('app/api/admin/cities/route.ts')).toContain('where: { ...COMMUNITY_MEMBER_WHERE, cityId: { in: cityIds } },')
    expect(COMMUNITY_MEMBER_WHERE.password).toEqual({ not: null })
  })
})

// ── Dates ───────────────────────────────────────────────────────────────────
describe('series dates', () => {
  it('monthly keeps the day and clamps it in shorter months', () => {
    expect(seriesDates('2026-01-31', 'monthly', 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29')   // leap year
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28')   // across a year end
  })
  it('weekly and biweekly step on the calendar', () => {
    expect(seriesDates('2026-10-22', 'weekly', 3)).toEqual(['2026-10-22', '2026-10-29', '2026-11-05'])
    expect(seriesDates('2026-12-24', 'biweekly', 2)).toEqual(['2026-12-24', '2027-01-07'])
    expect(seriesDates('2026-12-24', 'none', 5)).toEqual(['2026-12-24'])
  })
  it('date-only strings are formatted as days, not parsed as UTC midnight', () => {
    for (const f of ['app/admin/clubs/[id]/page.tsx', 'app/admin/feedback/page.tsx', 'app/admin/moderator/page.tsx', 'app/admin/events/new/page.tsx']) {
      expect(read(f)).not.toMatch(/new Date\((e|r\.event|d)\.?(date)?\)\.toLocaleDateString/)
    }
    const modHome = read('app/admin/moderator/page.tsx')
    expect(modHome).toContain('const hour = nowInTz(tz).hour')
    expect(modHome).not.toContain('new Date().getHours()')
  })
})
