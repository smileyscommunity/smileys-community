import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fifth scan, batch 32 — production data audit findings:
//   97. "spot opened" alerts are throttled per member: once per seat per
//       window (per event until scan 6 batch 10), at most a daily cap across
//       events; the first still immediate
//   98. the club memberCount recount counts what the live paths count —
//       banned members' rows don't come back overnight
//  100. an approval only enrols the member in their approved city's clubs
//       (or global ones); a repair script plans removal of the ones that didn't

const h = vi.hoisted(() => {
  const counts = new Map<string, number>()
  const hit = (key: string, limit: number) => {
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    return n <= limit
  }
  return {
    counts,
    rateLimit:    vi.fn(async (key: string, limit: number, _ms: number) => hit(key, limit)),
    claimOnce:    vi.fn(async (key: string, _ms: number) => hit(key, 1)),
    releaseClaim: vi.fn(async (key: string) => { counts.delete(key) }),
  }
})

vi.mock('@/lib/rateLimit', () => ({ rateLimit: h.rateLimit, claimOnce: h.claimOnce, releaseClaim: h.releaseClaim }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',     () => ({
  sendSpotOpenedEmail: vi.fn().mockResolvedValue(undefined), recordEmailFailure: vi.fn(),
  sendActivationEmail: vi.fn().mockResolvedValue(undefined), sendApplicationRejectedEmail: vi.fn().mockResolvedValue(undefined),
  sendRequestMoreInfoEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/spotsLeft',  () => ({ recomputeSpotsLeft: vi.fn().mockResolvedValue(undefined), expectedSpotsLeft: vi.fn() }))
vi.mock('@/lib/eventQuota', () => ({ hasQuotaRoomFor: vi.fn().mockResolvedValue({ ok: true }), quotaEventSelect: {} }))
vi.mock('@/lib/session',    () => ({ getSession: vi.fn().mockResolvedValue({ id: 'admin1', name: 'Admin', role: 'admin', cityId: 'c-ist' }) }))
vi.mock('@/lib/access',     () => ({ isAdmin: vi.fn(() => true), isAdminOrModerator: vi.fn(() => true), failClosedCityId: vi.fn(), canManageClubs: vi.fn(() => true) }))
vi.mock('@/lib/cronAuth',   () => ({ checkCronAuth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/cronHealth', () => ({ recordCronRun: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/city',       () => ({ citiesByToday: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/communitySettings', () => ({ loadCommunitySettings: vi.fn(() => ({ defaultClubId: null })) }))
vi.mock('@/lib/audit',       () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/promotePhoto', () => ({ promoteApplicationPhoto: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/neighborhoodsDb', () => ({ coerceNeighborhoodFor: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/cities',      () => ({ getStatsFor: vi.fn().mockResolvedValue(new Map()) }))
vi.mock('@/lib/cityMaturity', () => ({ CITY_MATURITY: { Seeding: 'seeding' } }))
vi.mock('@/lib/data',        () => ({ firstNameOf: (n: string) => n }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:       vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  $executeRaw:        vi.fn().mockResolvedValue(0),
  event:              { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
  waitlistEntry:      { findMany: vi.fn() },
  user:               { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  club:               { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  clubMembership:     { groupBy: vi.fn(), count: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
  memberApplication:  { findUnique: vi.fn(), update: vi.fn() },
  passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
  city:               { findUnique: vi.fn().mockResolvedValue({ name: 'Izmir' }) },
  rateLimit:          { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  session:            { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
} }))

import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendSpotOpenedEmail } from '@/lib/email'
import { writeAudit } from '@/lib/audit'
import { announceSpotOpened, SPOT_ALERT_DAILY_CAP, SPOT_ALERT_SEAT_WINDOW_MS } from '@/lib/spotOpened'
import { COUNTED_CLUB_MEMBERSHIP_WHERE } from '@/lib/clubMemberCount'
import { partitionClubsForCity } from '@/lib/approvalClubs'
import { POST as sweep } from '@/app/api/cron/sweep-event-spots/route'
import { POST as recount } from '@/app/api/admin/clubs/[id]/recount/route'
import { PATCH as reviewApplication } from '@/app/api/admin/applications/route'
import { planCrossCityRepairs, repairTargets, type PlanMembership } from '@/scripts/repair-cross-city-club-assignments'

const p = prisma as any
const req = (body: unknown = {}) => ({ json: async () => body }) as any

beforeEach(() => {
  vi.clearAllMocks()
  h.counts.clear()
})

// ── 97 ───────────────────────────────────────────────────────────────────────

describe('97. spot-opened alerts are throttled per member', () => {
  const EVENT = { title: 'Picnic', date: '2026-09-20', totalSpots: 10, soldOut: false, limitedSpots: true }

  // One seat (given back by `seat`) opening on `eventId`, with `waiting` on its waitlist.
  const open = (eventId: string, waiting: string[] = ['w1'], seat = 'x1') => {
    p.event.findUnique.mockReset()
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce({ spotsLeft: 1 })
    p.waitlistEntry.findMany.mockResolvedValueOnce(waiting.map(userId => ({ userId })))
    p.user.findMany.mockResolvedValueOnce(waiting.map(id => ({ id, name: id, email: `${id}@x`, gender: null, nationality: null })))
    return announceSpotOpened(eventId, [seat])
  }
  const alertsTo = (userId: string) => (createNotification as any).mock.calls.filter((c: any[]) => c[0] === userId).length

  it('the first alert goes out immediately, keyed per member per seat', async () => {
    expect(await open('e1')).toBe(1)
    expect(createNotification).toHaveBeenCalledTimes(1)
    expect(sendSpotOpenedEmail).toHaveBeenCalledTimes(1)
    expect(h.claimOnce).toHaveBeenCalledWith('spot-opened:w1:e1:x1', SPOT_ALERT_SEAT_WINDOW_MS)
    expect(SPOT_ALERT_SEAT_WINDOW_MS).toBe(6 * 3_600_000)
  })

  // Scan 6 batch 10: the window is per seat now — a new seat on the same
  // event alerts again (tests/scan6Batch10).
  it('the same seat opening again inside the window does not re-alert; a new seat does', async () => {
    await open('e1')
    expect(await open('e1')).toBe(0)
    expect(alertsTo('w1')).toBe(1)
    expect(sendSpotOpenedEmail).toHaveBeenCalledTimes(1)
    expect(await open('e1', ['w1'], 'x2')).toBe(1)
  })

  it('a different event still alerts, and other waitlisters are unaffected', async () => {
    await open('e1')
    expect(await open('e2')).toBe(1)
    expect(await open('e1', ['w1', 'w2'])).toBe(1)   // w1 suppressed, w2's first
    expect(alertsTo('w1')).toBe(2)
    expect(alertsTo('w2')).toBe(1)
  })

  it('caps a member at the daily limit across events, without burning the capped event', async () => {
    expect(SPOT_ALERT_DAILY_CAP).toBe(5)
    for (let i = 1; i <= SPOT_ALERT_DAILY_CAP + 2; i++) await open(`e${i}`)
    expect(alertsTo('w1')).toBe(SPOT_ALERT_DAILY_CAP)
    expect(h.rateLimit).toHaveBeenCalledWith('spot-opened-daily:w1', SPOT_ALERT_DAILY_CAP, 86_400_000)
    // The capped events' seat claims were handed back, so they can alert once the day resets.
    expect(h.releaseClaim).toHaveBeenCalledWith('spot-opened:w1:e6:x1')
    expect(h.counts.has('spot-opened:w1:e7:x1')).toBe(false)
  })

  it('fails open when the throttle store errors', async () => {
    h.claimOnce.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await open('e1')).toBe(1)
    err.mockRestore()
  })
})

// ── 98 ───────────────────────────────────────────────────────────────────────

describe('98. the club recount counts what the live paths count', () => {
  it('the shared definition is approved rows of members who are not banned', () => {
    expect(COUNTED_CLUB_MEMBERSHIP_WHERE).toEqual({ status: 'approved', user: { status: { not: 'banned' } } })
  })

  it('the nightly sweep groups by that definition, so a ban decrement stays', async () => {
    p.club.findMany.mockResolvedValue([{ id: 'k1', name: 'Book club', memberCount: 4 }])
    // 5 approved rows, one of them a banned member: the ban path took it to 4.
    p.clubMembership.groupBy.mockImplementation(async ({ where }: any) =>
      [{ clubId: 'k1', _count: { _all: where?.user?.status?.not === 'banned' ? 4 : 5 } }])
    const res = await sweep({} as any)
    const body = await res.json()
    expect(p.clubMembership.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: COUNTED_CLUB_MEMBERSHIP_WHERE }))
    expect(body.clubsFixed).toBe(0)
    expect(p.club.updateMany).not.toHaveBeenCalled()
  })

  it('the manual admin recount uses the same definition', async () => {
    p.club.findUnique.mockResolvedValue({ memberCount: 4 })
    p.clubMembership.count.mockResolvedValue(4)
    const res = await recount({} as any, { params: Promise.resolve({ id: 'k1' }) })
    expect(await res.json()).toEqual({ memberCount: 4, drift: 0 })
    expect(p.clubMembership.count).toHaveBeenCalledWith({ where: { clubId: 'k1', status: 'approved', user: { status: { not: 'banned' } } } })
  })
})

// ── 100 ──────────────────────────────────────────────────────────────────────

describe('100. approval only enrols in the approved city (or global) clubs', () => {
  const CLUBS = [
    { id: 'club-default-city', cityId: 'c-ist' },
    { id: 'club-izmir',        cityId: 'c-izm' },
    { id: 'club-global',       cityId: null },
  ]
  const APP = {
    id: 'a1', email: 'new@x', fullName: 'New Member', targetCityId: 'c-izm', profilePhoto: null, phone: null,
    country: null, gender: null, interests: [], socialStyles: [], lookingFor: [], emailMarketing: false,
    termsAcceptedAt: null, bio: null, instagram: null, neighborhood: null,
  }

  beforeEach(() => {
    p.memberApplication.findUnique.mockResolvedValue({ status: 'pending', targetCityId: 'c-izm', targetCity: { slug: 'izmir' } })
    p.memberApplication.update.mockImplementation(async ({ data }: any) => ({ ...APP, status: data.status, assignedClubs: data.assignedClubs ?? APP_STORED.assignedClubs }))
    p.club.findMany.mockImplementation(async ({ where }: any) => CLUBS.filter(c => where.id.in.includes(c.id)))
    p.user.findUnique.mockResolvedValue(null)
    p.user.create.mockResolvedValue({ id: 'u1', joinedAt: new Date() })
  })
  const APP_STORED = { assignedClubs: [] as string[] }
  const enrolled = () => p.clubMembership.upsert.mock.calls.map((c: any[]) => c[0].create.clubId)

  it('partitions by city: keeps the city and global clubs, skips another city with a reason', () => {
    expect(partitionClubsForCity(['club-default-city', 'club-izmir', 'club-global', 'club-izmir', 'nope'], CLUBS, 'c-izm')).toEqual({
      keep:    ['club-izmir', 'club-global'],
      skipped: [
        { clubId: 'club-default-city', reason: 'other_city', clubCityId: 'c-ist' },
        { clubId: 'nope', reason: 'not_found' },
      ],
    })
  })

  it('approving into İzmir skips the other city club and enrols the İzmir and global ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await reviewApplication(req({ id: 'a1', status: 'approved', assignedClubs: ['club-default-city', 'club-izmir', 'club-global'] }))
    warn.mockRestore()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(p.memberApplication.update.mock.calls[0][0].data.assignedClubs).toEqual(['club-izmir', 'club-global'])
    expect(enrolled().sort()).toEqual(['club-global', 'club-izmir'])
    expect(p.club.update).toHaveBeenCalledTimes(2)
    expect(body.skippedClubs).toEqual([{ clubId: 'club-default-city', reason: 'other_city', clubCityId: 'c-ist' }])
    const audit = (writeAudit as any).mock.calls.find((c: any[]) => c[2] === 'application.approve')
    expect(audit[5].skippedClubs).toHaveLength(1)
  })

  it('an approval that sends no clubs re-filters the list stored earlier', async () => {
    APP_STORED.assignedClubs = ['club-default-city', 'club-izmir']
    const res = await reviewApplication(req({ id: 'a1', status: 'approved' }))
    APP_STORED.assignedClubs = []
    expect(res.status).toBe(200)
    expect(enrolled()).toEqual(['club-izmir'])
  })
})

// ── 100 data repair planner ─────────────────────────────────────────────────

describe('100. repair-cross-city-club-assignments planner', () => {
  const reviewedAt = new Date('2026-08-20T10:00:00Z')
  const secs = (s: number) => new Date(reviewedAt.getTime() + s * 1000)
  const app = { id: 'a1', email: 'Ayse@X.com', targetCityId: 'c-ant', assignedClubs: ['k-ist', 'k-ant'], reviewedAt }
  const user = { id: 'u1', name: 'Ayşe Yılmaz', email: 'ayse@x.com', cityId: 'c-ant', status: 'approved', joinedAt: secs(2) }
  const m = (over: Partial<PlanMembership>): PlanMembership =>
    ({ id: 'm1', userId: 'u1', clubId: 'k-ist', status: 'approved', joinedAt: secs(3), clubName: 'Social', clubCityId: 'c-ist', ...over })
  const plan = (memberships: PlanMembership[], extra: Partial<Parameters<typeof planCrossCityRepairs>[0]> = {}) =>
    planCrossCityRepairs({ applications: [app], users: [user], memberships, joinedCities: [], ...extra })

  it('flags an assigned other-city club written with the approval as APPROVAL, initial only', () => {
    const [row] = plan([m({})])
    expect(row).toMatchObject({ origin: 'APPROVAL', initial: 'A.', memberCityId: 'c-ant', applicationCityId: 'c-ant', clubCityId: 'c-ist', membershipId: 'm1' })
    expect(JSON.stringify(row)).not.toContain('Yılmaz')
    expect(repairTargets([row])).toHaveLength(1)
  })

  it('ignores same-city and global clubs, and clubs in a city the member has joined', () => {
    expect(plan([m({ id: 'm2', clubId: 'k-ant', clubCityId: 'c-ant' }), m({ id: 'm3', clubId: 'k-g', clubCityId: null })])).toEqual([])
    expect(plan([m({})], { joinedCities: [{ userId: 'u1', cityId: 'c-ist' }] })).toEqual([])
  })

  it('never targets what it cannot pin to the approval', () => {
    const rows = plan([
      m({ id: 'late',   joinedAt: secs(2 * 86_400) }),                                    // assigned, written days later
      m({ id: 'self',   clubId: 'k-ist-2', joinedAt: secs(5 * 86_400) }),                 // joined on their own
      m({ id: 'pend',   status: 'pending' }),                                              // not an approved row
    ])
    expect(Object.fromEntries(rows.map(r => [r.membershipId, r.origin]))).toEqual({ late: 'UNSURE', self: 'SELF_JOINED', pend: 'UNSURE' })
    expect(repairTargets(rows)).toEqual([])
  })

  it('a registration-time enrolment is UNSURE (assignment and onboarding pick look the same)', () => {
    const registered = { ...user, joinedAt: secs(3 * 86_400) }
    const [row] = planCrossCityRepairs({ applications: [app], users: [registered], memberships: [m({ joinedAt: secs(3 * 86_400 + 1) })], joinedCities: [] })
    expect(row.origin).toBe('UNSURE')
  })

  it('a member who also applied to the club city is UNSURE', () => {
    const [row] = plan([m({})], { applications: [app, { ...app, id: 'a0', targetCityId: 'c-ist', assignedClubs: [], reviewedAt: secs(-86_400) }] })
    expect(row.origin).toBe('UNSURE')
  })
})
