import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Sixth scan, batch 9 — one member count everywhere.
//   a. the founding-member rank in the activation email disagreed with the
//      dashboard: the email counted approvals (never-activated accounts too)
//      and named never-activated people, the dashboard counted activated
//      members. 30 approved / 12 activated → email "#31", dashboard "#13".
//      Both now use lib/foundingRank; at approval the new account isn't
//      activated, so its rank is activated + 1.
//   b. member totals disagreed across surfaces: dashboard "Total members"
//      counted admins and partners, admin stats counted member+moderator only
//      (no hosts), city cards counted every role but admin/partner. The rule
//      is now that last one — every role except admin and partner, activated —
//      as COMMUNITY_MEMBER_WHERE in lib/memberCount.

const h = vi.hoisted(() => ({
  prisma: {
    user:                { count: vi.fn(), groupBy: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    event:               { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    club:                { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    city:                { findMany: vi.fn(), findUnique: vi.fn() },
    hangout:             { count: vi.fn(), groupBy: vi.fn() },
    hangoutReference:    { count: vi.fn() },
    eventAttendee:       { count: vi.fn(), groupBy: vi.fn() },
    eventSurvey:         { count: vi.fn() },
    clubMembership:      { groupBy: vi.fn() },
    memberApplication:   { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    report:              { count: vi.fn() },
    payment:             { groupBy: vi.fn() },
    visitorAnnouncement: { count: vi.fn() },
    emailFailure:        { count: vi.fn() },
    auditLog:            { create: vi.fn() },
    passwordResetToken:  { create: vi.fn() },
  },
  session:             { current: { id: 'admin1', name: 'Admin', role: 'admin', cityId: 'c-ist' } as any },
  sendActivationEmail: vi.fn(),
}))

vi.mock('@/lib/prisma',      () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',     () => ({ getSession: vi.fn(async () => h.session.current) }))
vi.mock('@/lib/access',      () => ({ canViewAnalytics: () => true, isAdmin: () => true, isAdminOrModerator: () => true, failClosedCityId: vi.fn() }))
vi.mock('@/lib/city',        () => ({ getCityTz: vi.fn(async () => 'Europe/Istanbul'), DEFAULT_CITY_SLUG: 'default-city', getDefaultCityId: vi.fn(), resolveCityId: vi.fn() }))
vi.mock('@/lib/cronHealth',  () => ({ listStaleSweepers: vi.fn(async () => []) }))
// The Reports pill's filter is lib/admin/reportScope's (tests/reportScope);
// here only that the route asks it about the dashboard's city.
vi.mock('@/lib/admin/reportScope', () => ({
  reportQueueWhere: vi.fn(async (_s: unknown, o?: { cityId?: string | null }) =>
    o?.cityId ? { reported: { is: { cityId: o.cityId } } } : {}),
}))
vi.mock('@/lib/notify',      () => ({ createNotification: vi.fn(async () => true) }))
vi.mock('@/lib/stepUp',      () => ({ requireStepUp: vi.fn(() => null) }))
vi.mock('@/lib/rateLimit',   () => ({ claimOnce: vi.fn(async () => true), releaseClaim: vi.fn(async () => {}), rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/email',       () => ({
  sendActivationEmail: h.sendActivationEmail, sendApplicationRejectedEmail: vi.fn(async () => {}),
  sendRequestMoreInfoEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}),
}))
vi.mock('@/lib/communitySettings', () => ({ loadCommunitySettings: vi.fn(() => ({ defaultClubId: null })) }))
vi.mock('@/lib/promotePhoto',      () => ({ promoteApplicationPhoto: vi.fn(async () => null) }))
vi.mock('@/lib/neighborhoodsDb',   () => ({ coerceNeighborhoodFor: vi.fn(async () => null) }))
vi.mock('next/cache',              () => ({ unstable_cache: (f: unknown) => f, revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/cityOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cityOps')>()),
  stalledLiveCities: vi.fn(async () => []),
}))
// Real getStatsFor by default (section b drives it); the approval tests make
// the target city seeding with a one-off resolved value.
vi.mock('@/lib/cities', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/cities')>()
  return { ...real, getStatsFor: vi.fn(real.getStatsFor) }
})

import { COMMUNITY_MEMBER_WHERE, ACTIVATED_MEMBER_WHERE, MEMBER_ROLE_FILTER } from '@/lib/memberCount'
import { foundingRankFor, foundingFellowNames } from '@/lib/foundingRank'
import { getStatsFor } from '@/lib/cities'
import { PATCH as reviewApplication } from '@/app/api/admin/applications/route'
import { GET as adminStatsGET } from '@/app/api/admin/stats/route'

const p = h.prisma as any
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const req  = (body: unknown) => ({ json: async () => body }) as any

// ── A tiny in-memory users table, so the counts are computed, not scripted ──

type U = { id: string; name: string; cityId: string; status: string; role: string; password: string | null; joinedAt: Date; foundingMember: boolean; hiddenFromMembers: boolean }
let users: U[] = []

function matches(u: any, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, c]) => {
    const v = u[k]
    if (c === null || typeof c !== 'object' || c instanceof Date) return v === c
    return Object.entries(c).every(([op, x]: [string, any]) => {
      switch (op) {
        case 'notIn': return !x.includes(v)
        case 'in':    return x.includes(v)
        case 'lte':   return v <= x
        case 'gte':   return v >= x
        case 'lt':    return v < x
        case 'not':   return v !== x
        default: throw new Error(`unsupported filter ${op} on ${k}`)
      }
    })
  })
}

const day = (n: number) => new Date(Date.UTC(2026, 7, n))
let seq = 0
const add = (over: Partial<U>) => {
  const u: U = {
    id: `u${++seq}`, name: `Person${seq}`, cityId: 'c-sd', status: 'approved', role: 'member',
    password: 'hash', joinedAt: day(seq), foundingMember: true, hiddenFromMembers: false, ...over,
  }
  users.push(u)
  return u
}

// Seeding city: 30 approved, of whom 12 activated (one of them a host). The
// never-activated ones joined FIRST, so a count or a name list that ignores
// activation shows up immediately. Plus accounts no rule should count: an
// activated admin and partner, a banned member, and a member elsewhere.
function seedCity() {
  users = []; seq = 0
  for (let i = 0; i < 18; i++) add({ password: null, name: `Never${i}` })
  for (let i = 0; i < 11; i++) add({ name: `Active${i}` })
  add({ role: 'host', name: 'Hostie' })
  add({ role: 'admin',   name: 'Staff' })
  add({ role: 'partner', name: 'Cafe' })
  add({ status: 'banned', name: 'Gone' })
  add({ cityId: 'c-other', name: 'Elsewhere' })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const model of Object.values(p) as Record<string, any>[]) {
    for (const [method, fn] of Object.entries(model)) {
      if (method === 'count') fn.mockResolvedValue(0)
      else if (method === 'groupBy' || method === 'findMany') fn.mockResolvedValue([])
      else fn.mockResolvedValue(null)
    }
  }
  seedCity()
  p.user.count.mockImplementation(async ({ where }: any) => users.filter(u => matches(u, where)).length)
  p.user.findMany.mockImplementation(async ({ where, orderBy, take }: any) => {
    let rows = users.filter(u => matches(u, where))
    if (orderBy?.joinedAt === 'asc') rows = [...rows].sort((a, b) => +a.joinedAt - +b.joinedAt)
    return rows.slice(0, take ?? rows.length).map(u => ({ name: u.name }))
  })
  p.user.create.mockImplementation(async ({ data }: any) => add({ ...data, id: 'u-new', joinedAt: new Date('2026-09-15T10:00:00Z'), foundingMember: !!data.foundingMember }))
  p.auditLog.create.mockResolvedValue({})
  p.passwordResetToken.create.mockResolvedValue({})
  p.city.findUnique.mockResolvedValue({ id: 'c-sd', name: 'Seedville', slug: 'seedville' })
  p.memberApplication.findUnique.mockResolvedValue({ status: 'pending', targetCityId: 'c-sd', targetCity: { slug: 'seedville' } })
  p.memberApplication.update.mockImplementation(async ({ data }: any) => ({
    id: 'a1', fullName: 'Nova Newcomer', email: 'nova@x.com', targetCityId: 'c-sd',
    assignedClubs: [], interests: [], socialStyles: [], lookingFor: [], status: data.status,
  }))
})

async function approveIntoSeedingCity() {
  vi.mocked(getStatsFor).mockResolvedValueOnce(new Map([['c-sd', { members: 12, clubs: 0, events: 0, maturity: 'seeding' }]]) as any)
  const res = await reviewApplication(req({ id: 'a1', status: 'approved' }))
  expect(res.status).toBe(200)
  expect(h.sendActivationEmail).toHaveBeenCalledTimes(1)
  return h.sendActivationEmail.mock.calls[0][5] as { rank: number; others: string[] }
}

describe('a. founding rank — the email and the dashboard agree', () => {
  it('the activation email ranks the new member after the ACTIVATED members (12 + 1, not 30 + 1)', async () => {
    const founding = await approveIntoSeedingCity()
    expect(founding.rank).toBe(13)
  })

  it('the email names only activated founding members', async () => {
    const founding = await approveIntoSeedingCity()
    expect(founding.others).toEqual(['Active0', 'Active1', 'Active2'])
    expect(founding.others.some(n => n.startsWith('Never'))).toBe(false)
  })

  it('once that member activates, the dashboard helper gives the same number the email did', async () => {
    const founding = await approveIntoSeedingCity()
    const nova = users.find(u => u.id === 'u-new')!
    nova.password = 'set-at-activation'
    expect(await foundingRankFor('c-sd', { joinedAt: nova.joinedAt, activated: true })).toBe(founding.rank)
  })

  it('the rank counts hosts and moderators but not admins, partners, the banned or other cities', async () => {
    const hostie = users.find(u => u.name === 'Hostie')!
    // Hostie is the 12th activated community member by join date.
    expect(await foundingRankFor('c-sd', { joinedAt: hostie.joinedAt, activated: true })).toBe(12)
    // Admin/partner/banned/elsewhere all joined after Hostie; still 12 for a later non-activated joiner + 1.
    expect(await foundingRankFor('c-sd', { joinedAt: day(40), activated: false })).toBe(13)
  })

  it('never ranks an activated viewer below 1', async () => {
    expect(await foundingRankFor('c-sd', { joinedAt: day(0), activated: true })).toBe(1)
  })

  it('fellow names skip the member themself and hidden members', async () => {
    users.find(u => u.name === 'Active0')!.hiddenFromMembers = true
    const active1 = users.find(u => u.name === 'Active1')!
    expect(await foundingFellowNames('c-sd', active1.id)).toEqual(['Active2', 'Active3', 'Active4'])
  })

  it('both call sites use the shared helper, with their own activation state', () => {
    const route = read('app/api/admin/applications/route.ts')
    expect(route).toMatch(/foundingRankFor\(application\.targetCityId, \{ joinedAt: user\.joinedAt, activated: false \}\)/)
    expect(route).toMatch(/foundingFellowNames\(application\.targetCityId, user\.id\)/)
    const dash = read('app/(member)/dashboard/page.tsx')
    expect(dash).toMatch(/foundingRankFor\(cityId, \{ joinedAt: userProfile\.joinedAt, activated: true \}\)/)
    // No private copy of the rank query or role list left behind.
    expect(dash).not.toMatch(/MEMBER_ROLES/)
    expect(route).not.toMatch(/MEMBER_ROLES/)
  })
})

describe('b. one "members" rule: activated, every role except admin and partner', () => {
  it('is ACTIVATED_MEMBER_WHERE plus the shared role filter', () => {
    expect(MEMBER_ROLE_FILTER).toEqual({ notIn: ['admin', 'partner'] })
    expect(COMMUNITY_MEMBER_WHERE).toEqual({ ...ACTIVATED_MEMBER_WHERE, role: MEMBER_ROLE_FILTER })
  })

  it('lib/cities (city cards + maturity) counts with it', async () => {
    p.city.findMany.mockResolvedValue([{ id: 'c-sd', timezone: 'Europe/Istanbul' }])
    await getStatsFor(['c-sd'])
    const where = p.user.groupBy.mock.calls[0][0].where
    expect(where).toEqual({ ...COMMUNITY_MEMBER_WHERE, cityId: { in: ['c-sd'] } })
    expect(where.role).toBe(MEMBER_ROLE_FILTER)
  })

  it('admin stats counts members, activated and not-activated with the same role filter (hosts included)', async () => {
    const res = await adminStatsGET(new Request('http://x/api/admin/stats?city=c-sd'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const wheres = p.user.count.mock.calls.map((c: any) => c[0].where)
    expect(wheres).toContainEqual({ ...COMMUNITY_MEMBER_WHERE, cityId: 'c-sd' })
    // Same object, not a look-alike literal.
    const memberWheres = wheres.filter((w: any) => w.status === 'approved' && w.role?.notIn)
    expect(memberWheres).toHaveLength(3)
    for (const w of memberWheres) expect(w.role).toBe(MEMBER_ROLE_FILTER)
    expect(wheres.some((w: any) => Array.isArray(w.role?.in))).toBe(false)
    // Computed over the seeded table: 12 activated incl. the host, 18 not.
    expect(body.membersActivated).toBe(12)
    expect(body.membersNotActivated).toBe(18)
    expect(body.members).toBe(30)
  })

  it('the dashboard founding gate and "Total members" count with it', () => {
    const src = read('app/(member)/dashboard/page.tsx')
    expect(src.match(/prisma\.user\.count\(\{\s*where: \{ \.\.\.COMMUNITY_MEMBER_WHERE, cityId \}/g)).toHaveLength(2)
    expect(src).not.toMatch(/ACTIVATED_MEMBER_WHERE/)
  })
})
