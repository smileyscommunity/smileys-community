import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fifth scan, batch 39 — lower-severity hygiene from the production audit.
//   a. self-deletion scrubs the application row (and other copies of the
//      address) to a tombstone; scripts/scrub-deleted-member-applications.ts
//      planning
//   b. the nightly name-hygiene sweep deletes expired auth tokens in batches
//      and reports the count
//   c. join requests to clubs with no approved host reach a staff queue —
//      every admin, and a moderator of that city only; the admin clubs list
//      carries hostCount; scripts/audit-club-hosting.ts planning
//   d. connection requests pending over 90 days are deleted by the same sweep
//   e. scripts/audit-hygiene-orphans.ts planning

const h = vi.hoisted(() => {
  const calls: Record<string, any[]> = {}
  const results: Record<string, any> = {}
  const model = (m: string) => new Proxy({}, { get: (_t, method: string) => (...args: any[]) => {
    const key = `${m}.${method}`
    ;(calls[key] ??= []).push(args[0])
    if (key in results) return Promise.resolve(typeof results[key] === 'function' ? results[key](args[0]) : results[key])
    if (method === 'count') return Promise.resolve(0)
    if (method === 'findMany' || method === 'groupBy') return Promise.resolve([])
    if (method === 'findUnique' || method === 'findFirst') return Promise.resolve(null)
    if (method === 'deleteMany' || method === 'updateMany') return Promise.resolve({ count: 0 })
    return Promise.resolve({})
  } })
  const prisma: any = new Proxy({}, { get: (_t, m: string) =>
    m === '$transaction' ? (ops: any) => (typeof ops === 'function' ? ops(prisma) : Promise.all(ops))
    : m === '$queryRaw' || m === '$queryRawUnsafe' ? () => Promise.resolve([])
    : model(m) })
  return { prisma, calls, results, getSession: vi.fn() }
})

vi.mock('@/lib/prisma',            () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',           () => ({ getSession: h.getSession, deleteSession: vi.fn(async () => {}) }))
vi.mock('@/lib/rateLimit',         () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true) }))
vi.mock('@/lib/audit',             () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/admin/userHistory', () => ({ snapshotUserHistory: vi.fn(async () => ({})) }))
vi.mock('@/lib/spotsLeft',         () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/city',              () => ({ todayInCity: vi.fn(async () => '2026-09-14'), resolveCityId: vi.fn(async () => 'c-bodrum'), resolveTargetCityId: vi.fn() }))
vi.mock('@/lib/survey',            () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()), aggregateRollup: vi.fn(() => null) }))
vi.mock('@/lib/cronAuth',          () => ({ checkCronAuth: vi.fn(async () => null) }))
vi.mock('@/lib/cronHealth',        () => ({ recordCronRun: vi.fn(async () => {}) }))
vi.mock('bcryptjs',                () => ({ default: { compare: vi.fn(async () => true) } }))

import { POST as deleteAccountPOST } from '@/app/api/auth/delete-account/route'
import { POST as nameHygienePOST }   from '@/app/api/cron/sweep-name-hygiene/route'
import { GET as clubRequestsGET }    from '@/app/api/admin/clubs/requests/route'
import { GET as adminClubsGET }      from '@/app/api/admin/clubs/route'
import { GET as modStatsGET }        from '@/app/api/admin/mod-stats/route'
import { HYGIENE_BATCH_SIZE, HYGIENE_MAX_BATCHES } from '@/lib/hygieneSweeps'
import { applicationPiiFields, applicationScrubData, APPLICATION_PII_NULLABLE_FIELDS } from '@/lib/applicationScrub'
import { isModeratorPageAllowed } from '@/lib/adminNav'
import { planApplicationScrub, type ApplicationFacts, type DeletedAccount } from '@/scripts/scrub-deleted-member-applications'
import { planClubHosting, ageBucket } from '@/scripts/audit-club-hosting'
import { planHygieneOrphans, membershipVisibility, isExpectedAuditOrphan } from '@/scripts/audit-hygiene-orphans'

const last = (key: string) => h.calls[key]?.at(-1)
const jsonReq = (body: any = {}) => ({ json: async () => body }) as any
const urlReq = (url: string) => ({ url, nextUrl: new URL(url), json: async () => ({}) }) as any
const BODRUM = 'c-bodrum', ISTANBUL = 'c-istanbul'
const DAY = 86_400_000

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(h.calls)) delete h.calls[k]
  for (const k of Object.keys(h.results)) delete h.results[k]
})

// A row with every PII column filled — what an untouched application looks like.
const filledApplication = (over: Partial<ApplicationFacts> = {}): ApplicationFacts => ({
  id: 'app1', createdAt: new Date('2026-05-01'),
  email: 'jane@example.com', fullName: 'Jane Doe', firstName: 'Jane', lastName: 'Doe',
  ...Object.fromEntries(APPLICATION_PII_NULLABLE_FIELDS.map(f => [f, `secret-${f}`])),
  ...over,
} as ApplicationFacts)

// ── a. self-deletion ───────────────────────────────────────────────────────
describe('a. self-deletion scrubs the application row', () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue({ id: 'u1', name: 'Jane Doe', role: 'member', cityId: BODRUM })
    h.results['user.findUnique'] = { password: 'hash', status: 'approved', name: 'Jane Doe', email: 'Jane@Example.com', phone: '+90 555', lastFingerprint: 'fp' }
  })

  it('tombstones name, email, contact, answers and fingerprints; keeps stats fields', async () => {
    const res = await deleteAccountPOST(jsonReq({ password: 'pw' }))
    expect(res.status).toBe(200)

    const app = last('memberApplication.updateMany')
    expect(app.where).toEqual({ email: { equals: 'Jane@Example.com', mode: 'insensitive' } })
    // Same ghost address as the user row: still linked, routes nowhere.
    const ghost = last('user.update').data.email
    expect(ghost).toMatch(/^deleted_[0-9a-f]{12}@deleted\.smileys$/)
    expect(app.data.email).toBe(ghost)
    expect(app.data).toMatchObject({
      fullName: 'Deleted member', phone: null, instagram: null, linkedin: null, bio: null,
      whyJoin: null, toxicBehavior: null, profilePhoto: null, birthdate: null,
      ipAddress: null, fingerprint: null, userAgent: null, reviewNote: null, emailMarketing: false,
    })
    for (const kept of ['city', 'targetCityId', 'status', 'source', 'createdAt', 'reviewedAt', 'interests']) {
      expect(app.data).not.toHaveProperty(kept)
    }
    // Nothing identifying survives on a fully filled row.
    expect(applicationPiiFields({ ...filledApplication(), ...app.data })).toEqual([])
  })

  it('also clears the Pro waitlist signup, failed-send logs and a self-submitted testimonial', async () => {
    await deleteAccountPOST(jsonReq({ password: 'pw' }))
    expect(last('proWaitlistEntry.deleteMany').where).toEqual({ OR: [{ userId: 'u1' }, { email: { equals: 'Jane@Example.com', mode: 'insensitive' } }] })
    expect(last('emailFailure.deleteMany').where).toEqual({ recipient: { equals: 'Jane@Example.com', mode: 'insensitive' } })
    const t = last('testimonial.updateMany')
    expect(t.where).toEqual({ userId: 'u1' })
    expect(t.data).toMatchObject({ memberName: 'Deleted Member', photo: null, active: false })
  })

  it('a wrong password scrubs nothing', async () => {
    const bcrypt = (await import('bcryptjs')).default as any
    bcrypt.compare.mockResolvedValueOnce(false)
    const res = await deleteAccountPOST(jsonReq({ password: 'nope' }))
    expect(res.status).toBe(403)
    expect(h.calls['memberApplication.updateMany']).toBeUndefined()
  })
})

describe('a. scripts/scrub-deleted-member-applications planning', () => {
  const deleted: DeletedAccount[] = [
    { userId: 'd1', tombstoneEmail: 'deleted_aa@deleted.smileys', originalEmail: 'Gone@x.com',  deletedAt: new Date('2026-08-01') },
    { userId: 'd2', tombstoneEmail: 'deleted_bb@deleted.smileys', originalEmail: 'back@x.com',  deletedAt: new Date('2026-07-01') },
    { userId: 'd3', tombstoneEmail: 'deleted_cc@deleted.smileys', originalEmail: 'later@x.com', deletedAt: new Date('2026-06-01') },
    { userId: 'd4', tombstoneEmail: 'deleted_dd@deleted.smileys', originalEmail: null,          deletedAt: null },
  ]
  const scrubbed = { ...filledApplication(), ...applicationScrubData('deleted_aa@deleted.smileys') }
  const apps: ApplicationFacts[] = [
    filledApplication({ id: 'sure-original', email: 'gone@x.com' }),
    filledApplication({ id: 'unsure-live',   email: 'back@x.com' }),
    filledApplication({ id: 'unsure-newer',  email: 'later@x.com', createdAt: new Date('2026-07-15') }),
    // The old partial scrub never touched the email; a tombstone-address row
    // with leftovers is still a sure link.
    { ...scrubbed, id: 'sure-tombstone', fullName: 'Jane Doe', whyJoin: 'my words' },
    { ...scrubbed, id: 'unsure-orphan-tombstone', email: 'deleted_zz@deleted.smileys', fullName: 'Jane Doe' },
    { ...scrubbed, id: 'clean' },
    filledApplication({ id: 'stranger', email: 'stranger@x.com' }),
  ]
  const plan = planApplicationScrub({ apps, deleted, liveEmails: new Set(['back@x.com']) })
  const verdict = (id: string) => plan.rows.find(r => r.id === id)

  it('SURE only for a pre-deletion application with no live account, or one already on the tombstone', () => {
    expect(verdict('sure-original')).toMatchObject({ verdict: 'sure', userId: 'd1', tombstoneEmail: 'deleted_aa@deleted.smileys' })
    expect(verdict('sure-tombstone')).toMatchObject({ verdict: 'sure', userId: 'd1', piiFields: ['fullName', 'whyJoin'] })
    expect(verdict('unsure-live')?.verdict).toBe('unsure')
    expect(verdict('unsure-newer')?.verdict).toBe('unsure')
    expect(verdict('unsure-orphan-tombstone')).toMatchObject({ verdict: 'unsure', tombstoneEmail: null })
    expect(verdict('clean')).toBeUndefined()
    expect(verdict('stranger')).toBeUndefined()
    expect(plan.counts).toEqual({ listed: 5, sure: 2, unsure: 3, alreadyClean: 1, deletedAccounts: 4, deletedWithoutEmail: 1 })
  })

  it('what the script prints holds field names, never the values', () => {
    const printable = JSON.stringify(plan.rows.map(({ seenEmail: _s, tombstoneEmail: _t, ...r }) => r))
    expect(printable).not.toMatch(/Jane|secret-|@x\.com|my words/)
    expect(verdict('sure-original')!.piiFields).toEqual(expect.arrayContaining(['fullName', 'email', 'phone', 'whyJoin', 'ipAddress']))
  })
})

// ── b + d. nightly sweep ───────────────────────────────────────────────────
describe('b/d. the name-hygiene sweep deletes expired tokens and stale requests', () => {
  const NOW = new Date('2026-09-14T03:20:00Z')
  const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }))
  const countIds = (a: any) => ({ count: a.where.id.in.length })

  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('deletes only rows past expiry + 1 day, batch by batch, and reports the counts', async () => {
    const prt = [ids(HYGIENE_BATCH_SIZE, 'p'), ids(3, 'q')]
    const evt = [ids(2, 'v')]
    const conns = [ids(4, 'c')]
    h.results['passwordResetToken.findMany']     = () => prt.shift() ?? []
    h.results['passwordResetToken.deleteMany']   = countIds
    h.results['emailVerificationToken.findMany'] = () => evt.shift() ?? []
    h.results['emailVerificationToken.deleteMany'] = countIds
    h.results['memberConnection.findMany']       = () => conns.shift() ?? []
    h.results['memberConnection.deleteMany']     = countIds

    const res = await nameHygienePOST({} as any)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, expiredTokens: { passwordReset: HYGIENE_BATCH_SIZE + 3, emailVerification: 2 }, staleConnectionRequests: 4 })
    // Counts lead the summary (the cron wrapper logs the first 300 chars).
    expect(Object.keys(body).slice(0, 3)).toEqual(['ok', 'expiredTokens', 'staleConnectionRequests'])

    const cutoff = new Date(NOW.getTime() - DAY)
    expect(h.calls['passwordResetToken.findMany']).toHaveLength(2)   // a short batch ends the loop
    for (const find of h.calls['passwordResetToken.findMany']) {
      expect(find).toEqual({ where: { expiresAt: { lt: cutoff } }, select: { id: true }, take: HYGIENE_BATCH_SIZE })
    }
    // The expiry condition is repeated on the delete itself.
    expect(h.calls['passwordResetToken.deleteMany'][0].where).toEqual({ id: { in: ids(HYGIENE_BATCH_SIZE, 'p').map(r => r.id) }, expiresAt: { lt: cutoff } })
    expect(last('emailVerificationToken.deleteMany').where).toEqual({ id: { in: ['v0', 'v1'] }, expiresAt: { lt: cutoff } })

    // d. pending only, untouched for 90 days — declined decline-memory never matches.
    expect(last('memberConnection.deleteMany').where).toEqual({
      id: { in: ['c0', 'c1', 'c2', 'c3'] }, status: 'pending', updatedAt: { lt: new Date(NOW.getTime() - 90 * DAY) },
    })
  })

  it('a huge backlog is capped per night', async () => {
    h.results['passwordResetToken.findMany']   = () => ids(HYGIENE_BATCH_SIZE, 'p')
    h.results['passwordResetToken.deleteMany'] = countIds
    const body = await (await nameHygienePOST({} as any)).json()
    expect(h.calls['passwordResetToken.findMany']).toHaveLength(HYGIENE_MAX_BATCHES)
    expect(body.expiredTokens.passwordReset).toBe(HYGIENE_BATCH_SIZE * HYGIENE_MAX_BATCHES)
  })
})

// ── c. staff queue for hostless clubs ──────────────────────────────────────
describe('c. join requests to clubs with no approved host', () => {
  const row = (clubId: string, clubCity: string | null, userCity: string, userId: string) => ({
    joinedAt: new Date(Date.now() - 10 * DAY), userCity,
    user: { id: userId, name: `M ${userId}`, color: '#000' },
    club: { id: clubId, slug: clubId, name: `Club ${clubId}`, emoji: '🎉', cityId: clubCity, isActive: true, isPrivate: true, city: clubCity ? { name: clubCity } : null },
  })
  const pending = [
    row('bodrum-hostless',   BODRUM,   BODRUM,   'u1'),
    row('bodrum-hosted',     BODRUM,   BODRUM,   'u2'),
    row('istanbul-hostless', ISTANBUL, ISTANBUL, 'u3'),
    row('global-hostless',   null,     BODRUM,   'u4'),
    row('global-hostless',   null,     ISTANBUL, 'u5'),
  ]
  // Applies the route's where the way Postgres would, for the shapes it builds.
  const matches = (r: typeof pending[number], where: any) =>
    !where.OR || where.OR.some((o: any) => o.club.cityId === r.club.cityId && (!o.user || o.user.cityId === r.userCity))

  beforeEach(() => {
    h.results['clubMembership.findMany'] = (a: any) => a.where.role === 'host'
      ? ['bodrum-hosted'].filter(id => a.where.clubId.in.includes(id)).map(clubId => ({ clubId }))
      : pending.filter(r => matches(r, a.where)).map(({ userCity: _u, ...r }) => (a.select.clubId ? { clubId: r.club.id } : r))
  })
  const listFor = async (session: any, url = 'http://x/app/api/admin/clubs/requests') => {
    h.getSession.mockResolvedValue(session)
    const res = await clubRequestsGET(urlReq(url))
    return { status: res.status, body: await res.json() }
  }
  const users = (body: any) => body.requests.map((r: any) => r.userId).sort()

  it('an admin sees every hostless request; ?scope=all adds hosted ones, flagged', async () => {
    const { body } = await listFor({ id: 'a', role: 'admin', cityId: ISTANBUL })
    expect(users(body)).toEqual(['u1', 'u3', 'u4', 'u5'])
    expect(body.hostlessCount).toBe(4)
    const all = await listFor({ id: 'a', role: 'admin', cityId: ISTANBUL }, 'http://x/a?scope=all')
    expect(users(all.body)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5'])
    expect(all.body.requests.find((r: any) => r.userId === 'u2').hasHost).toBe(true)
    // "Host" means approved and not banned — the counted-membership rule.
    expect(h.calls['clubMembership.findMany'].find((a: any) => a.where.role === 'host').where)
      .toMatchObject({ status: 'approved', user: { status: { not: 'banned' } }, role: 'host' })
  })

  it('a moderator sees only their city: its clubs, and global clubs for their own members', async () => {
    expect(users((await listFor({ id: 'm', role: 'moderator', cityId: BODRUM })).body)).toEqual(['u1', 'u4'])
    expect(users((await listFor({ id: 'm', role: 'moderator', cityId: ISTANBUL })).body)).toEqual(['u3', 'u5'])
    expect(users((await listFor({ id: 'm', role: 'moderator' })).body)).toEqual([])   // no city → fail closed
  })

  it('members and hosts are refused', async () => {
    expect((await listFor({ id: 'x', role: 'member', cityId: BODRUM })).status).toBe(403)
    expect((await listFor(null)).status).toBe(403)
  })

  it('Mod Home counts the same scoped queue', async () => {
    h.getSession.mockResolvedValue({ id: 'm', role: 'moderator', cityId: BODRUM })
    const body = await (await modStatsGET()).json()
    expect(body.hostlessClubRequests).toBe(2)
  })

  it('the admin clubs list carries hostCount', async () => {
    h.getSession.mockResolvedValue({ id: 'a', role: 'admin', cityId: ISTANBUL })
    h.results['club.findMany'] = [{ id: 'bodrum-hostless' }, { id: 'bodrum-hosted' }]
    h.results['clubMembership.groupBy'] = (a: any) => a.where.role === 'host' ? [{ clubId: 'bodrum-hosted', _count: { _all: 2 } }] : []
    const body = await (await adminClubsGET(urlReq('http://x/app/api/admin/clubs'))).json()
    expect(body.map((c: any) => [c.id, c.hostCount])).toEqual([['bodrum-hostless', 0], ['bodrum-hosted', 2]])
  })

  it('moderators can open the queue page; the admin-only clubs page stays closed to them', () => {
    expect(isModeratorPageAllowed('/admin/club-requests')).toBe(true)
    expect(isModeratorPageAllowed('/admin/clubs')).toBe(false)
  })
})

describe('c. scripts/audit-club-hosting planning', () => {
  it('groups active hostless clubs by city and ages every pending request', () => {
    const now = new Date('2026-09-14')
    const club = (id: string, cityName: string | null, isActive = true) => ({ id, name: id, slug: id, cityName, isActive, isPrivate: false, memberCount: 3 })
    const plan = planClubHosting({
      clubs: [club('zeta', 'Bodrum'), club('alpha', 'Bodrum'), club('hosted', 'Bodrum'), club('dormant', 'Izmir', false), club('world', null)],
      hostedClubIds: new Set(['hosted']),
      pending: [
        { clubId: 'alpha',  requestedAt: new Date(now.getTime() - 2 * DAY) },
        { clubId: 'alpha',  requestedAt: new Date(now.getTime() - 120 * DAY) },
        { clubId: 'hosted', requestedAt: new Date(now.getTime() - 40 * DAY) },
      ],
      now,
    })
    expect(plan.hostlessByCity.map(g => [g.city, g.clubs.map(c => c.id)])).toEqual([['Bodrum', ['alpha', 'zeta']], ['Global', ['world']]])
    expect(plan.pendingRows.map(r => [r.ageDays, r.hasHost])).toEqual([[120, false], [40, true], [2, false]])
    expect(plan.counts).toMatchObject({ activeClubs: 4, activeHostless: 3, pending: 3, pendingHostless: 2 })
    expect(plan.counts.byBucket).toEqual({ '<7d': { hosted: 0, hostless: 1 }, '7-30d': { hosted: 0, hostless: 0 }, '30-90d': { hosted: 1, hostless: 0 }, '>90d': { hosted: 0, hostless: 1 } })
    expect([ageBucket(6), ageBucket(7), ageBucket(89), ageBucket(90)]).toEqual(['<7d', '7-30d', '30-90d', '>90d'])
  })
})

// ── e. orphans audit ───────────────────────────────────────────────────────
describe('e. scripts/audit-hygiene-orphans planning', () => {
  it('says where an inactive-club membership still shows, and separates expected audit orphans', () => {
    expect(membershipVisibility({ status: 'approved', role: 'host', userStatus: 'approved' })).toHaveLength(3)
    expect(membershipVisibility({ status: 'approved', role: 'member', userStatus: 'approved' })).toHaveLength(1)
    expect(membershipVisibility({ status: 'pending', role: 'member', userStatus: 'approved' })).toEqual([])
    expect(membershipVisibility({ status: 'approved', role: 'host', userStatus: 'banned' })).toEqual([])
    expect([isExpectedAuditOrphan('user.remove'), isExpectedAuditOrphan('guide_entry_delete'), isExpectedAuditOrphan('user.role_change')]).toEqual([true, true, false])

    const m = (id: string, status: string, role: string) => ({ id, clubId: 'c', clubName: 'C', userId: 'u', status, role, userStatus: 'approved' })
    const plan = planHygieneOrphans({
      inactiveMemberships: [m('m1', 'approved', 'host'), m('m2', 'approved', 'member'), m('m3', 'pending', 'member')],
      paymentOrphans: [{ id: 'p1', status: 'paid', parentMissing: ['event'] }],
      reviewOrphans:  [],
      auditOrphans: [
        { id: 'a1', action: 'user.remove',      targetType: 'user', targetId: 'x' },
        { id: 'a2', action: 'user.remove',      targetType: 'user', targetId: 'y' },
        { id: 'a3', action: 'user.role_change', targetType: 'user', targetId: 'z' },
      ],
    })
    expect(plan.unexpectedAudit.map(a => a.id)).toEqual(['a3'])
    expect(plan.expectedByAction).toEqual({ 'user.remove': 2 })
    expect(plan.counts).toEqual({
      inactiveMemberships: 3, inactiveMembershipsVisible: 2, inactiveHosts: 1,
      paymentOrphans: 1, reviewOrphans: 0, auditOrphansUnexpected: 1, auditOrphansExpected: 2,
    })
  })
})
