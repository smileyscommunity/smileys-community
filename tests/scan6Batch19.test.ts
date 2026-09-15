import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Sixth scan, batch 19 — three low-severity count/day leftovers.
//   25. City club lists and the regional seeding recount counted approved
//       membership rows only, so banned members were counted back in (the
//       seeding run wrote that into Club.memberCount until the nightly
//       recount). Both use COUNTED_CLUB_MEMBERSHIP_WHERE now.
//   29. Admin analytics counted members as role IN ['member','moderator'] —
//       hosts dropped — after every other surface moved to MEMBER_ROLE_FILTER.
//       Dormant list: COMMUNITY_MEMBER_WHERE (activated). Ban-rate denominator
//       and cohort set: approval-level with MEMBER_ROLE_FILTER.
//   30. a) moving-sales GET hid expired sales by the UTC day while POST/PATCH
//       use the city's day. b) neighbourhood HeroStats counted members who hid
//       their neighbourhood / admin-hidden accounts and computed "today" and
//       "this month" in server UTC.

const h = vi.hoisted(() => ({
  prisma: {
    club:                { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    clubMembership:      { findMany: vi.fn(), createMany: vi.fn(), count: vi.fn() },
    user:                { findMany: vi.fn(), count: vi.fn() },
    city:                { findUnique: vi.fn() },
    event:               { findMany: vi.fn(), groupBy: vi.fn() },
    eventAttendee:       { findMany: vi.fn(), groupBy: vi.fn() },
    eventRecommendation: { findMany: vi.fn() },
    memberApplication:   { findMany: vi.fn() },
    payment:             { findMany: vi.fn() },
    report:              { findMany: vi.fn(), groupBy: vi.fn() },
    hangout:             { findMany: vi.fn() },
    hangoutReference:    { findMany: vi.fn() },
    auditLog:            { findMany: vi.fn() },
    movingSale:          { findMany: vi.fn() },
    $queryRaw:           vi.fn(),
  },
  tz: { current: 'Europe/Istanbul' },
}))

vi.mock('@/lib/prisma',           () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',          () => ({ getSession: vi.fn(async () => ({ id: 'a1', name: 'Admin', role: 'admin', cityId: 'c-tbs' })) }))
vi.mock('@/lib/access',           () => ({ canViewAnalytics: () => true }))
vi.mock('@/lib/analyticsCache',   () => ({ getCached: () => null, setCached: () => {} }))
vi.mock('@/lib/city',             () => ({
  getCityTz:     vi.fn(async () => h.tz.current),
  getCityConfig: vi.fn(async () => ({ showGlobalClubs: true })),
  todayInCity:   vi.fn(async () => '2026-09-15'),
  resolveCityId: vi.fn(async () => 'c-tbs'),
}))
vi.mock('@/lib/cities',           () => ({ getPublicCity: vi.fn(async () => null) }))
vi.mock('@/lib/cityMembership',   () => ({ resolvePostingCityId: vi.fn(async () => 'c-tbs') }))
vi.mock('@/lib/rateLimit',        () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/neighborhoodsDb',  () => ({ safeNeighborhoodFor: vi.fn(async () => null) }))
vi.mock('@/lib/email',            () => ({ sendListingAlertEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/notify',           () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/authorProjection', () => ({ authorProjector: vi.fn(async () => (u: unknown) => u) }))

import { NextRequest } from 'next/server'
import { COUNTED_CLUB_MEMBERSHIP_WHERE } from '@/lib/clubMemberCount'
import { COMMUNITY_MEMBER_WHERE, MEMBER_ROLE_FILTER } from '@/lib/memberCount'
import { getClubs } from '@/lib/db'
import { seedRegionalClubs, COUNTRY_TO_CLUBS } from '@/lib/regionalClubSeeding'
import { GET as analyticsGET } from '@/app/api/admin/analytics/route'
import { GET as movingGET } from '@/app/api/moving-sales/route'

const p = h.prisma as any
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

beforeEach(() => {
  vi.clearAllMocks()
  h.tz.current = 'Europe/Istanbul'
  for (const model of Object.values(p)) {
    if (typeof model === 'function') { (model as any).mockResolvedValue([]); continue }
    for (const [name, fn] of Object.entries(model as Record<string, any>)) {
      fn.mockResolvedValue(name === 'count' ? 0 : name.startsWith('find') && name !== 'findMany' ? null : [])
    }
  }
})

afterEach(() => { vi.useRealTimers() })

describe('25. club member counts exclude banned members', () => {
  it('the shared rule is approved rows whose user is not banned', () => {
    expect(COUNTED_CLUB_MEMBERSHIP_WHERE).toEqual({ status: 'approved', user: { status: { not: 'banned' } } })
  })

  it("a city's club list counts both totals by the rule", async () => {
    p.club.findMany.mockResolvedValue([{ id: 'k1', slug: 'x', name: 'X', cityId: 'c-tbs', _count: { memberships: 3 }, memberships: [], events: [] }])
    const [club] = await getClubs('c-tbs')
    const include = p.club.findMany.mock.calls[0][0].include
    expect(include._count.select.memberships.where).toEqual(COUNTED_CLUB_MEMBERSHIP_WHERE)
    // The city-scoped count merges the city into the rule's user filter —
    // a plain `user: { cityId }` would silently drop the ban exclusion.
    expect(include.memberships.where).toEqual({ status: 'approved', user: { status: { not: 'banned' }, cityId: 'c-tbs' } })
    expect(club.memberCount).toBe(3)
  })

  it('the seeding recount writes Club.memberCount by the rule', async () => {
    const slugs = [...new Set(Object.values(COUNTRY_TO_CLUBS).flat())]
    p.club.findMany.mockResolvedValue(slugs.map((slug, i) => ({ id: `club${i}`, slug, name: slug })))
    p.user.findMany.mockResolvedValue([{ id: 'u1', nationality: 'Sweden' }])
    p.clubMembership.count.mockResolvedValue(7)

    const res = await seedRegionalClubs({ dryRun: false })
    expect(res.written).toBe(true)
    expect(p.clubMembership.count).toHaveBeenCalledTimes(slugs.length)
    for (const [arg] of p.clubMembership.count.mock.calls) {
      expect(arg.where).toEqual({ clubId: expect.any(String), ...COUNTED_CLUB_MEMBERSHIP_WHERE })
    }
    expect(p.club.update).toHaveBeenCalledWith({ where: { id: 'club0' }, data: { memberCount: 7 } })
  })
})

describe('29. analytics member counts use the shared role rule', () => {
  const run = async () => {
    p.city.findUnique.mockResolvedValue({ id: 'c-tbs', name: 'Tbilisi', slug: 'tbilisi' })
    p.report.groupBy.mockResolvedValue([])
    const res = await analyticsGET(new NextRequest('http://x/app/api/admin/analytics?city=c-tbs&period=6m'))
    return res
  }

  it('the dormant list is activated community members (hosts included), city-scoped', async () => {
    await run()
    const dormant = p.user.findMany.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.where?.joinedEvents)
    expect(dormant).toBeDefined()
    expect(dormant.where).toMatchObject({ ...COMMUNITY_MEMBER_WHERE, cityId: 'c-tbs' })
    expect(dormant.where.role).toEqual({ notIn: ['admin', 'partner'] })
  })

  it('the ban-rate denominator is approved members by MEMBER_ROLE_FILTER, city-scoped', async () => {
    await run()
    expect(p.user.count).toHaveBeenCalledTimes(1)
    expect(p.user.count.mock.calls[0][0].where).toEqual({ status: 'approved', role: MEMBER_ROLE_FILTER, cityId: 'c-tbs' })
  })

  it('the cohort set is approved members by MEMBER_ROLE_FILTER, city-scoped', async () => {
    await run()
    const cohort = p.user.findMany.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.select?.email && a.select?.lastActive)
    expect(cohort).toBeDefined()
    expect(cohort.where).toEqual({ status: 'approved', role: MEMBER_ROLE_FILTER, cityId: 'c-tbs' })
  })

  it('no member+moderator-only role list is left in the route', () => {
    expect(read('app/api/admin/analytics/route.ts')).not.toMatch(/role: \{ in: \['member', 'moderator'\] \}/)
  })
})

describe("30a. moving-sales GET hides expired sales by the city's day", () => {
  it('01:00 in Tbilisi (21:00 UTC the day before) floors at the Tbilisi date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-14T21:00:00Z'))
    h.tz.current = 'Asia/Tbilisi'
    await movingGET(new NextRequest('http://x/app/api/moving-sales'))
    const where = p.movingSale.findMany.mock.calls[0][0].where
    // The UTC day would be 2026-09-14 and keep yesterday's sales listed.
    expect(where.leavingOn).toEqual({ gte: '2026-09-15' })
    expect(where.cityId).toBe('c-tbs')
  })

  it('the route no longer reads the UTC day', () => {
    expect(read('app/api/moving-sales/route.ts')).not.toContain('toISOString()')
  })
})

// HeroStats is a .tsx server component (no JSX transform in vitest) — source pins.
describe('30b. neighbourhood HeroStats', () => {
  const src = read('app/neighborhoods/[slug]/HeroStats.tsx')

  it('"local members" excludes hidden-neighbourhood and admin-hidden accounts, like NeighborhoodSections', () => {
    expect(src).toMatch(/prisma\.user\.count\(\{ where: \{ \.\.\.ACTIVATED_MEMBER_WHERE, neighborhood: name, cityId, neighborhoodVisible: true, hiddenFromMembers: false \} \}\)/)
  })

  it('"today" and "this month" come from the city timezone, not server UTC', () => {
    expect(src).toContain('const today    = todayInTz(await getCityTz(cityId))')
    // The month is now a bounded range from lib/cityTime (scan6Batch27).
    expect(src).toContain('const month    = monthRangeFor(today)')
    expect(src).not.toContain('toISOString()')
    expect(src).not.toMatch(/setHours\(/)
  })
})
