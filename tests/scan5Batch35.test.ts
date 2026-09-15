import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Fifth scan, batch 35 — member totals and referral counts. The production
// audit found 268 approved members who never activated inside every "N
// members", and User.referralCount drifted for 20 users.
//   a. one activated-member rule (lib/memberCount)
//   b. marketing stats, city stats + maturity and the cup base count by it
//   c. the admin dashboard shows activated and approved-not-activated
//   d. page surfaces use it (source pins: .tsx and cached loaders)
//   e. referral counts come from approved applications; the column is unread
//   f. scripts/audit-unactivated-members.ts planning
//   g. scripts/repair-referral-counts.ts planning + guarded apply

const h = vi.hoisted(() => ({
  prisma: {
    user:                { count: vi.fn(), groupBy: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    event:               { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    club:                { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    city:                { findMany: vi.fn(), findUnique: vi.fn() },
    hangout:             { count: vi.fn(), groupBy: vi.fn() },
    hangoutReference:    { count: vi.fn() },
    eventAttendee:       { count: vi.fn(), groupBy: vi.fn() },
    eventSurvey:         { count: vi.fn() },
    clubMembership:      { groupBy: vi.fn() },
    memberApplication:   { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    report:              { count: vi.fn() },
    payment:             { groupBy: vi.fn() },
    visitorAnnouncement: { count: vi.fn() },
    emailFailure:        { count: vi.fn() },
    cupPrediction:       { groupBy: vi.fn(), aggregate: vi.fn() },
    cupBracketPick:      { findMany: vi.fn(), aggregate: vi.fn() },
    cupFixture:          { aggregate: vi.fn() },
  },
  getSession: vi.fn(),
}))

vi.mock('@/lib/prisma',        () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',       () => ({ getSession: h.getSession }))
vi.mock('@/lib/access',        () => ({ canViewAnalytics: () => true }))
vi.mock('@/lib/city',          () => ({ getCityTz: vi.fn(async () => 'Europe/Istanbul'), DEFAULT_CITY_SLUG: 'default-city', getDefaultCityId: vi.fn(), resolveCityId: vi.fn() }))
vi.mock('@/lib/cronHealth',    () => ({ listStaleSweepers: vi.fn(async () => []) }))
vi.mock('@/lib/memberPrivacy', () => ({ restrictedSetFor: vi.fn(async () => new Set()) }))
vi.mock('@/lib/rateLimit',     () => ({ rateLimit: vi.fn(async () => true), getIp: () => '1.2.3.4' }))
vi.mock('next/cache',          () => ({ unstable_cache: (f: unknown) => f, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('web-push',            () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }))
vi.mock('@/lib/cityOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cityOps')>()),
  stalledLiveCities: vi.fn(async () => []),
}))

import { ACTIVATED_MEMBER_WHERE, NOT_ACTIVATED_MEMBER_WHERE } from '@/lib/memberCount'
import { countedReferralsWhere, REFERRAL_COUNTED_STATUSES } from '@/lib/referrals'
import { getCommunityStats } from '@/lib/communityStats'
import { getStatsFor } from '@/lib/cities'
import { GET as leaderboardGET } from '@/app/api/cup/leaderboard/route'
import { GET as adminStatsGET } from '@/app/api/admin/stats/route'
import { GET as inviteGET } from '@/app/api/invite/route'
import { GET as referralContextGET } from '@/app/api/apply/referral-context/route'
import { ageBucket, tokenState, planUnactivated, planClubGap, type UnactivatedFacts } from '@/scripts/audit-unactivated-members'
import { planReferralRepairs, applyReferralRepairs } from '@/scripts/repair-referral-counts'

const p = h.prisma as any
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const isActivated    = (w: any) => w?.status === 'approved' && w?.password?.not === null
const isNotActivated = (w: any) => w?.status === 'approved' && w?.password === null

beforeEach(() => {
  vi.clearAllMocks()
  for (const model of Object.values(p) as Record<string, any>[]) {
    for (const [method, fn] of Object.entries(model)) {
      if (method === 'count') fn.mockResolvedValue(0)
      else if (method === 'groupBy' || method === 'findMany') fn.mockResolvedValue([])
      else if (method === 'aggregate') fn.mockResolvedValue({ _max: { updatedAt: null } })
      else fn.mockResolvedValue(null)
    }
  }
})

describe('a. one activated-member rule', () => {
  it('is approved with a password set; its complement is approved without one', () => {
    expect(ACTIVATED_MEMBER_WHERE).toEqual({ status: 'approved', password: { not: null } })
    expect(NOT_ACTIVATED_MEMBER_WHERE).toEqual({ status: 'approved', password: null })
  })
})

describe('b. shared counters count activated members', () => {
  it('marketing stats (footer, About, landing "live" rows)', async () => {
    p.user.count.mockResolvedValue(1174)
    const s = await getCommunityStats()
    expect(p.user.count).toHaveBeenCalledWith({ where: ACTIVATED_MEMBER_WHERE })
    expect(s.members).toBe(1174)
  })

  it('city stats — and so maturity — count activated community members', async () => {
    p.city.findMany.mockResolvedValue([{ id: 'c1', timezone: 'Europe/Istanbul' }])
    // 30 approved would make a forming city; 19 of them activated does not.
    p.user.groupBy.mockImplementation(async ({ where }: any) =>
      [{ cityId: 'c1', _count: { _all: isActivated(where) ? 19 : 30 } }])
    p.event.groupBy.mockResolvedValue([{ cityId: 'c1', _count: { _all: 2 } }])
    p.club.findMany.mockResolvedValue([{ cityId: 'c1' }])

    const s = (await getStatsFor(['c1'])).get('c1')!
    expect(p.user.groupBy.mock.calls[0][0].where).toEqual({
      status: 'approved', password: { not: null }, cityId: { in: ['c1'] }, role: { notIn: ['admin', 'partner'] },
    })
    expect(s.members).toBe(19)
    expect(s.maturity).toBe('seeding')
  })

  it('the cup "N members playing" base', async () => {
    h.getSession.mockResolvedValue({ id: 'me', role: 'member' })
    const res = await leaderboardGET(new Request('http://x/api/cup/leaderboard'))
    expect(res.status).toBe(200)
    expect(p.user.count).toHaveBeenCalledWith({ where: ACTIVATED_MEMBER_WHERE })
  })
})

describe('c. admin dashboard shows both halves of the funnel', () => {
  it('returns activated and approved-not-activated members, city-scoped', async () => {
    h.getSession.mockResolvedValue({ id: 'a', role: 'admin' })
    p.city.findUnique.mockResolvedValue({ id: 'c-b', name: 'B', slug: 'b' })
    p.user.count.mockImplementation(async ({ where }: any) => isActivated(where) ? 40 : isNotActivated(where) ? 12 : 52)

    const res  = await adminStatsGET(new Request('http://x/api/admin/stats?city=c-b'))
    const body = await res.json()
    expect(body.membersActivated).toBe(40)
    expect(body.membersNotActivated).toBe(12)
    const wheres = p.user.count.mock.calls.map((c: any) => c[0].where)
    // Every role but admin/partner since scan6Batch9 (member+moderator dropped hosts).
    expect(wheres).toContainEqual({ ...ACTIVATED_MEMBER_WHERE,     role: { notIn: ['admin', 'partner'] }, cityId: 'c-b' })
    expect(wheres).toContainEqual({ ...NOT_ACTIVATED_MEMBER_WHERE, role: { notIn: ['admin', 'partner'] }, cityId: 'c-b' })
  })

  it('the Members card leads with activated and names the gap', () => {
    const src = read('app/admin/page.tsx')
    expect(src).toMatch(/value: stats\?\.membersActivated/)
    expect(src).toMatch(/stats\.membersNotActivated\} approved, not activated/)
    expect(read('app/admin/content/page.tsx')).toMatch(/activated members<\/span>/)
  })
})

describe('d. public and member-facing member totals use the rule', () => {
  const SURFACES: [string, RegExp][] = [
    ['app/page.tsx',                                     /prisma\.user\.count\(\{ where: ACTIVATED_MEMBER_WHERE \}\)/],
    ['app/[city]/data.ts',                               /\.\.\.ACTIVATED_MEMBER_WHERE, role: 'member', joinedAt/],
    ['app/neighborhoods/[slug]/HeroStats.tsx',           /user\.count\(\{ where: \{ \.\.\.ACTIVATED_MEMBER_WHERE, neighborhood: name, cityId, neighborhoodVisible: true, hiddenFromMembers: false \} \}\)/],
    ['app/neighborhoods/[slug]/NeighborhoodSections.tsx', /user\.count\(\{ where: \{ \.\.\.ACTIVATED_MEMBER_WHERE, neighborhood: name, cityId, neighborhoodVisible/],
    ['app/neighborhoods/page.tsx',                       /\.\.\.ACTIVATED_MEMBER_WHERE, cityId, neighborhood: \{ not: null \}/],
    ['app/guide/page.tsx',                               /\.\.\.ACTIVATED_MEMBER_WHERE, neighborhood: \{ not: null \}, cityId/],
    ['app/visiting/page.tsx',                            /\.\.\.ACTIVATED_MEMBER_WHERE, neighborhood: \{ not: null \}, cityId/],
  ]
  it.each(SURFACES)('%s', (file, re) => expect(read(file)).toMatch(re))

  it('the dashboard founding gate, rank and "Total members" count activated members', () => {
    const src = read('app/(member)/dashboard/page.tsx')
    // COMMUNITY_MEMBER_WHERE is ACTIVATED_MEMBER_WHERE plus the member-role
    // rule; the rank lives in lib/foundingRank (scan6Batch9).
    expect(src).toMatch(/cityMemberCount = await prisma\.user\.count\(\{\s*where: \{ \.\.\.COMMUNITY_MEMBER_WHERE, cityId \}/)
    expect(src).toMatch(/const rank = await foundingRankFor\(cityId, \{ joinedAt: userProfile\.joinedAt, activated: true \}\)/)
    expect(src).toMatch(/prisma\.user\.count\(\{ where: \{ \.\.\.COMMUNITY_MEMBER_WHERE, cityId \} \}\)/)
    expect(src).not.toMatch(/prisma\.user\.count\(\{ where: \{ cityId, status: 'approved' \} \}\)/)
  })
})

describe('e. referral counts come from approved applications', () => {
  it('a referral is real once its application is approved', () => {
    expect(countedReferralsWhere('ABCD2345')).toEqual({ referredBy: 'ABCD2345', status: { in: ['approved', 'active'] } })
  })

  it('/api/invite reports the computed count, whatever the stored column says', async () => {
    h.getSession.mockResolvedValue({ id: 'me', role: 'member' })
    p.user.findUnique.mockResolvedValue({ referralCode: 'ABCD2345', referralCount: 7, name: 'Me' })
    p.memberApplication.count.mockImplementation(async ({ where }: any) => where.status === 'pending' ? 1 : 3)

    const body = await (await inviteGET()).json()
    expect(body).toMatchObject({ code: 'ABCD2345', referralCount: 3, approved: 3, pending: 1 })
    expect(p.user.findUnique.mock.calls[0][0].select).not.toHaveProperty('referralCount')
    expect(p.memberApplication.count).toHaveBeenCalledWith({ where: countedReferralsWhere('ABCD2345') })
  })

  it('the apply page’s inviter tally counts the same statuses', async () => {
    await referralContextGET(new Request('http://x/api/apply/referral-context') as any)
    expect(p.memberApplication.groupBy.mock.calls[0][0].where)
      .toEqual({ referredBy: { not: null }, status: { in: [...REFERRAL_COUNTED_STATUSES] } })
  })

  it('the profile badge and the dashboard impact card read the same rule', () => {
    expect(read('app/api/members/[id]/route.ts')).toMatch(/memberApplication\.count\(\{ where: countedReferralsWhere\(user\.referralCode\) \}\)/)
    expect(read('app/(member)/dashboard/page.tsx')).toMatch(/where: countedReferralsWhere\(userProfile\.referralCode\)/)
  })

  it('nothing in app/, lib/ or components/ reads User.referralCount', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) { if (e.name !== 'generated' && e.name !== 'node_modules') walk(rel); continue }
        if (!/\.tsx?$/.test(e.name)) continue
        // Code only — the WHY comments naming the retired column are fine.
        const code = read(rel).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
        if (/referralCount: true|\.referralCount\b/.test(code)) hits.push(rel)
      }
    }
    for (const root of ['app', 'lib', 'components']) walk(root)
    expect(hits).toEqual([])
  })
})

describe('f. scripts/audit-unactivated-members planning', () => {
  const now = new Date('2026-09-14T10:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)

  it('buckets approval age at 7, 30 and 90 days', () => {
    expect(ageBucket(daysAgo(6.9), now)).toBe('<7d')
    expect(ageBucket(daysAgo(7), now)).toBe('7-30d')
    expect(ageBucket(daysAgo(29.9), now)).toBe('7-30d')
    expect(ageBucket(daysAgo(30), now)).toBe('30-90d')
    expect(ageBucket(daysAgo(89.9), now)).toBe('30-90d')
    expect(ageBucket(daysAgo(90), now)).toBe('>90d')
  })

  it('a link is valid only while an unused token is unexpired', () => {
    expect(tokenState([], now)).toBe('none')
    expect(tokenState([{ expiresAt: daysAgo(-1), used: false }], now)).toBe('valid')
    expect(tokenState([{ expiresAt: daysAgo(1),  used: false }], now)).toBe('expired')
    expect(tokenState([{ expiresAt: daysAgo(-1), used: true }], now)).toBe('none')
    expect(tokenState([{ expiresAt: daysAgo(1), used: false }, { expiresAt: daysAgo(-3), used: false }], now)).toBe('valid')
  })

  it('tallies by city, approval age, club membership and link state', () => {
    const f = (userId: string, city: string, days: number, clubMemberships: number, tokens: UnactivatedFacts['tokens'] = []): UnactivatedFacts =>
      ({ userId, city, joinedAt: daysAgo(days), clubMemberships, tokens })
    const plan = planUnactivated([
      f('u1', 'ist', 2,   0, [{ expiresAt: daysAgo(-5), used: false }]),
      f('u2', 'ist', 45,  3, [{ expiresAt: daysAgo(38), used: false }]),
      f('u3', 'izm', 120, 1),
      f('u4', 'ist', 200, 0),
    ], now)
    expect(plan.overall).toEqual({
      total: 4, byAge: { '<7d': 1, '7-30d': 0, '30-90d': 1, '>90d': 2 },
      byToken: { valid: 1, expired: 1, none: 2 }, withClubs: 2, clubMemberships: 4,
    })
    expect(plan.cities.map(c => [c.city, c.total, c.withClubs, c.clubMemberships])).toEqual([['ist', 3, 1, 3], ['izm', 1, 1, 1]])
  })

  it('the club gap lists clubs holding never-activated enrolments, biggest first', () => {
    const gap = planClubGap([
      { clubId: 'k1', name: 'Hiking',  city: 'ist', memberCount: 50, unactivated: 5 },
      { clubId: 'k2', name: 'Books',   city: 'ist', memberCount: 20, unactivated: 0 },
      { clubId: 'k3', name: 'Sailing', city: 'izm', memberCount: 10, unactivated: 8 },
    ])
    expect(gap.rows.map(r => [r.clubId, r.activatedEnrolment])).toEqual([['k3', 2], ['k1', 45]])
    expect(gap.totals).toEqual({ clubs: 2, unactivatedEnrolments: 13, memberCountOfThoseClubs: 60 })
  })

  it('is read-only: no writes, no tokens, no email', () => {
    const src = read('scripts/audit-unactivated-members.ts')
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|issueActivationToken|lib\/email/)
  })
})

describe('g. scripts/repair-referral-counts', () => {
  it('lists every stored count that differs from approved applications, cleared codes included', () => {
    const { repairs, counts } = planReferralRepairs([
      { id: 'u1', referralCode: 'AAAA2222', referralCount: 0 },
      { id: 'u2', referralCode: 'BBBB3333', referralCount: 2 },
      { id: 'u3', referralCode: 'CCCC4444', referralCount: 5 },
      { id: 'u4', referralCode: null,       referralCount: 3 },
    ], new Map([['AAAA2222', 4], ['BBBB3333', 2]]))
    expect(repairs).toEqual([
      { id: 'u3', referralCode: 'CCCC4444', old: 5, new: 0 },
      { id: 'u1', referralCode: 'AAAA2222', old: 0, new: 4 },
      { id: 'u4', referralCode: null,       old: 3, new: 0 },
    ])
    expect(counts).toEqual({ checked: 4, drifted: 3, tooHigh: 2, tooLow: 1 })
  })

  it('APPLY writes guarded on the value it read and skips a row that moved', async () => {
    p.user.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const res = await applyReferralRepairs([
      { id: 'u1', referralCode: 'AAAA2222', old: 0, new: 4 },
      { id: 'u2', referralCode: null,       old: 3, new: 0 },
    ])
    expect(p.user.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 'u1', referralCount: 0 }, data: { referralCount: 4 } })
    expect(p.user.updateMany).toHaveBeenNthCalledWith(2, { where: { id: 'u2', referralCount: 3 }, data: { referralCount: 0 } })
    expect(res).toEqual({ updated: 1, skipped: 1 })
  })

  it('defaults to a dry run', () => {
    expect(read('scripts/repair-referral-counts.ts')).toMatch(/const APPLY_MODE = process\.env\.APPLY === '1'/)
  })
})
