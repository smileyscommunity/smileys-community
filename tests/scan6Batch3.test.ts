import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sixth scan, batch 3 — applications left under a member's OLD email address.
// Applications are keyed by email (no userId). An email change left the row on
// the old address, where it looked orphaned (the 2026-09-14 orphan scrub erased
// six live members' applications) and where self-deletion could not find it.
//   a. self-service email change moves the application in its transaction
//   b. self-deletion also scrubs applications under earlier, audited addresses
//   c. the admin email edit moves the application too
//   d. scripts/relink-email-changed-applications.ts planning

const h = vi.hoisted(() => {
  const calls: Record<string, any[]> = {}
  const results: Record<string, any> = {}
  // `prefix` separates the transaction client's calls from the outer client's,
  // so a test can prove a write happened INSIDE the transaction.
  const client = (prefix: string): any => new Proxy({}, { get: (_t, m: string) => {
    if (m === '$transaction') return (ops: any) => (typeof ops === 'function' ? ops(client('tx:')) : Promise.all(ops))
    return new Proxy({}, { get: (_t2, method: string) => (...args: any[]) => {
      const key = `${m}.${method}`
      if (prefix) (calls[prefix + key] ??= []).push(args[0])
      ;(calls[key] ??= []).push(args[0])
      if (key in results) return Promise.resolve(typeof results[key] === 'function' ? results[key](args[0]) : results[key])
      if (method === 'count') return Promise.resolve(0)
      if (method === 'findMany' || method === 'groupBy') return Promise.resolve([])
      if (method === 'findUnique' || method === 'findFirst') return Promise.resolve(null)
      if (method === 'deleteMany' || method === 'updateMany') return Promise.resolve({ count: 0 })
      return Promise.resolve({})
    } })
  } })
  return { prisma: client(''), calls, results, getSession: vi.fn(), writeAudit: vi.fn(async () => {}) }
})

vi.mock('@/lib/prisma',            () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',           () => ({ getSession: h.getSession, createSession: vi.fn(async () => {}), deleteSession: vi.fn(async () => {}) }))
vi.mock('@/lib/rateLimit',         () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true), getIp: vi.fn(() => '1.2.3.4') }))
vi.mock('@/lib/audit',             () => ({ writeAudit: h.writeAudit, getDiff: vi.fn(() => ({})) }))
vi.mock('@/lib/email',             () => ({
  sendVerificationEmail:   vi.fn(async () => {}),
  sendEmailChangedNotice:  vi.fn(async () => {}),
  sendPremiumUpgradeEmail: vi.fn(async () => {}),
  recordEmailFailure:      vi.fn(async () => {}),
}))
vi.mock('@/lib/totpCrypto',        () => ({ decryptTotpSecret: vi.fn(() => 'secret') }))
vi.mock('otplib/functional',       () => ({ verifySync: vi.fn(() => ({ valid: true })) }))
vi.mock('@/lib/admin/userHistory', () => ({ snapshotUserHistory: vi.fn(async () => ({})) }))
vi.mock('@/lib/spotsLeft',         () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/city',              () => ({ todayInCity: vi.fn(async () => '2026-09-15'), resolveCityId: vi.fn(async () => 'c-ist'), resolveTargetCityId: vi.fn() }))
vi.mock('@/lib/notify',            () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/survey',            () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()), aggregateRollup: vi.fn(() => null) }))
vi.mock('@/lib/neighborhoodsDb',   () => ({ normalizeNeighborhoodInput: vi.fn(async (_c: string, v: string) => ({ ok: true, value: v })) }))
vi.mock('bcryptjs',                () => ({ default: { compare: vi.fn(async () => true) } }))

import { POST as updateEmailPOST }   from '@/app/api/auth/update-email/route'
import { POST as deleteAccountPOST } from '@/app/api/auth/delete-account/route'
import { PATCH as adminUserPATCH }   from '@/app/api/admin/users/[id]/route'
import { planRelink, isLiveUser, normPhone, normName, firstLastKey, APPROVAL_TIMING_WINDOW_MS, type RelinkApplication, type RelinkUser } from '@/scripts/relink-email-changed-applications'

const all = (key: string) => h.calls[key] ?? []
const jsonReq = (body: any = {}) => ({ json: async () => body, headers: new Headers() }) as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(h.calls)) delete h.calls[k]
  for (const k of Object.keys(h.results)) delete h.results[k]
})

// ── a. self-service email change ───────────────────────────────────────────
describe('a. update-email moves the application with the address', () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue({ id: 'u1', name: 'Jane', email: 'jane@old.com', role: 'member', totpVerified: false })
    // Looked up by id → the member; by the new address → nobody holds it.
    h.results['user.findUnique'] = (args: any) => args.where.id
      ? { id: 'u1', email: 'Jane@Old.com', password: 'hash', totpEnabled: false, totpSecret: null }
      : null
  })

  it('moves rows under the old address (case-insensitive) inside the transaction', async () => {
    const res = await updateEmailPOST(jsonReq({ email: ' Jane@New.com ', password: 'pw' }))
    expect(res.status).toBe(200)

    const moved = all('tx:memberApplication.updateMany')
    expect(moved).toEqual([{ where: { email: { equals: 'Jane@Old.com', mode: 'insensitive' } }, data: { email: 'jane@new.com' } }])
    // Not a separate, non-atomic write on the outer client.
    expect(all('memberApplication.updateMany')).toHaveLength(1)
    expect(all('tx:user.update')[0].data.email).toBe('jane@new.com')
  })

  it('records the change so self-deletion can find the earlier address', async () => {
    await updateEmailPOST(jsonReq({ email: 'jane@new.com', password: 'pw' }))
    expect(h.writeAudit).toHaveBeenCalledWith('u1', 'Jane', 'user.email_change', 'u1', 'user',
      expect.objectContaining({ from: 'Jane@Old.com', to: 'jane@new.com' }), expect.any(String))
  })

  it('an address already in use moves nothing', async () => {
    h.results['user.findUnique'] = (args: any) => args.where.id
      ? { id: 'u1', email: 'jane@old.com', password: 'hash', totpEnabled: false }
      : { id: 'someone-else' }
    const res = await updateEmailPOST(jsonReq({ email: 'taken@x.com', password: 'pw' }))
    expect(res.status).toBe(409)
    expect(all('memberApplication.updateMany')).toEqual([])
    expect(h.writeAudit).not.toHaveBeenCalled()
  })
})

// ── b. self-deletion ───────────────────────────────────────────────────────
describe('b. delete-account scrubs applications under earlier addresses', () => {
  const changedAt = new Date('2026-08-01T10:00:00Z')
  beforeEach(() => {
    h.getSession.mockResolvedValue({ id: 'u1', name: 'Jane', role: 'member', cityId: 'c-ist' })
    h.results['user.findUnique'] = { password: 'hash', status: 'approved', name: 'Jane', email: 'b@y.com', phone: null, lastFingerprint: null }
  })

  it('scrubs the current address AND an audited earlier one, filed before the change, to the same tombstone', async () => {
    h.results['auditLog.findMany'] = [
      { meta: { from: 'A@X.com', to: 'b@y.com' }, createdAt: changedAt },
      { meta: { from: 'B@Y.com', to: 'c@z.com' }, createdAt: new Date('2026-08-02') },   // same as current: not repeated
    ]
    const res = await deleteAccountPOST(jsonReq({ password: 'pw' }))
    expect(res.status).toBe(200)

    expect(all('tx:auditLog.findMany')[0].where).toEqual({ action: 'user.email_change', targetId: 'u1' })
    const scrubs = all('tx:memberApplication.updateMany')
    expect(scrubs.map(s => s.where)).toEqual([
      { email: { equals: 'b@y.com', mode: 'insensitive' } },
      { email: { equals: 'a@x.com', mode: 'insensitive' }, createdAt: { lte: changedAt } },
    ])
    const ghost = all('tx:user.update').at(-1).data.email
    expect(ghost).toMatch(/^deleted_[0-9a-f]{12}@deleted\.smileys$/)
    expect(scrubs[1].data).toMatchObject({ email: ghost, fullName: 'Deleted member', phone: null, whyJoin: null })
  })

  it('uses the LAST time the member left an address as the cutoff', async () => {
    const later = new Date('2026-09-01')
    h.results['auditLog.findMany'] = [
      { meta: { from: 'a@x.com' }, createdAt: changedAt },
      { meta: { from: 'a@x.com' }, createdAt: later },
    ]
    await deleteAccountPOST(jsonReq({ password: 'pw' }))
    const earlier = all('memberApplication.updateMany').filter(s => s.where.createdAt)
    expect(earlier).toEqual([expect.objectContaining({ where: { email: { equals: 'a@x.com', mode: 'insensitive' }, createdAt: { lte: later } } })])
  })

  it('leaves an earlier address alone when another account holds it now', async () => {
    h.results['auditLog.findMany'] = [{ meta: { from: 'a@x.com' }, createdAt: changedAt }]
    h.results['user.findFirst'] = (args: any) => args.where.email.equals === 'a@x.com' ? { id: 'someone-else' } : null
    await deleteAccountPOST(jsonReq({ password: 'pw' }))
    expect(all('user.findFirst')[0].where).toEqual({ id: { not: 'u1' }, email: { equals: 'a@x.com', mode: 'insensitive' } })
    expect(all('memberApplication.updateMany').map(s => s.where)).toEqual([{ email: { equals: 'b@y.com', mode: 'insensitive' } }])
  })

  it('ignores audit rows without a usable from address', async () => {
    h.results['auditLog.findMany'] = [{ meta: null, createdAt: changedAt }, { meta: { from: '  ' }, createdAt: changedAt }]
    await deleteAccountPOST(jsonReq({ password: 'pw' }))
    expect(all('memberApplication.updateMany')).toHaveLength(1)
  })
})

// ── c. admin email edit ────────────────────────────────────────────────────
describe('c. admin email edit moves the application too', () => {
  const admin = { id: 'a1', name: 'Admin', email: 'admin@x.com', role: 'admin', cityId: 'c-ist', color: '#000', totpVerified: true }
  const params = { params: Promise.resolve({ id: 'u1' }) }
  const patch = (body: any) => adminUserPATCH(jsonReq(body), params)
  beforeEach(() => {
    h.getSession.mockResolvedValue(admin)
    h.results['user.findUnique'] = (args: any) => args.where.id
      ? { role: 'member', status: 'approved', name: 'Jane', email: 'old@x.com', phone: null, suspendedUntil: null, cityId: 'c-ist', membershipType: 'free' }
      : null
  })

  it('updates the user and moves old-address applications in one transaction', async () => {
    const res = await patch({ email: ' New@Y.com ' })
    expect(res.status).toBe(200)
    expect(all('user.update')[0]).toEqual({ where: { id: 'u1' }, data: { email: 'new@y.com' } })
    expect(all('memberApplication.updateMany')).toEqual([
      { where: { email: { equals: 'old@x.com', mode: 'insensitive' } }, data: { email: 'new@y.com' } },
    ])
    expect(h.writeAudit).toHaveBeenCalledWith('a1', 'Admin', 'user.email_change', 'u1', 'user',
      expect.objectContaining({ from: 'old@x.com', to: 'new@y.com' }), expect.any(String))
  })

  it('a profile edit without an email change leaves applications alone', async () => {
    expect((await patch({ bio: 'hi' })).status).toBe(200)
    expect((await patch({ email: 'OLD@x.com', bio: 'hi' })).status).toBe(200)   // same address, different case: a no-op
    expect(all('user.update')).toHaveLength(2)
    expect(all('memberApplication.updateMany')).toEqual([])
  })
})

// ── d. relink planning ─────────────────────────────────────────────────────
describe('d. scripts/relink-email-changed-applications planning', () => {
  const T = new Date('2026-06-01T10:00:00Z')
  const PHONE_A = '+90 555 123 45 67', PHONE_A_LOCAL = '05551234567', PHONE_B = '+90 555 222 33 44'
  // joinedAt defaults far from reviewedAt, so approval timing never applies by accident.
  const user = (over: Partial<RelinkUser>): RelinkUser =>
    ({ id: 'u', email: 'u@x.com', name: 'Jane Doe', phone: PHONE_A, status: 'approved', banReason: null,
       joinedAt: new Date('2025-01-01T00:00:00Z'), hasLinkedApplication: false, ...over })
  const app = (over: Partial<RelinkApplication>): RelinkApplication =>
    ({ id: 'a', email: 'old@x.com', fullName: 'Jane Doe', phone: PHONE_A_LOCAL, reviewedAt: T, ...over })
  const at = (ms: number) => new Date(T.getTime() + ms)

  it('normalises phones to the last 10 digits and names with accents, ı/İ and punctuation folded', () => {
    expect(normPhone('+90 555 123 45 67')).toBe('5551234567')
    expect(normPhone('05551234567')).toBe('5551234567')
    expect(normPhone('(555) 123-456')).toBe('555123456')
    expect(normPhone('555 12 34')).toBeNull()
    expect(normPhone(null)).toBeNull()
    expect(normName('  Büşra   IŞIK ')).toBe('busra isik')
    expect(normName('İlkay Öztürk-Çelik')).toBe('ilkay ozturk celik')
    expect(normName('ılgın')).toBe('ilgin')
    expect(firstLastKey(normName('Ayşe Nur Yılmaz'))).toBe('ayse yilmaz')
    expect(firstLastKey('cher')).toBeNull()
  })

  it('relinks when normalised name AND phone match one live account with no application, across phone formats', () => {
    const { rows, counts } = planRelink({
      apps:  [app({ id: 'a1', fullName: '  jane DOE ', phone: '05551234567' })],
      users: [user({ id: 'u1', email: 'New@Y.com', phone: '+90 555 123 45 67' }), user({ id: 'u2', email: 'u2@x.com', phone: PHONE_B })],
    })
    expect(rows).toEqual([{ id: 'a1', verdict: 'relink', userId: 'u1', basis: 'name+phone', seenEmail: 'old@x.com', newEmail: 'New@Y.com' }])
    expect(counts).toMatchObject({ relink: 1, duplicate: 0, ambiguous: 0 })
  })

  it('relinks across accent and Turkish ı/İ folding', () => {
    const { rows } = planRelink({
      apps:  [app({ id: 'a1', fullName: 'Büşra Işık' }), app({ id: 'a2', email: 'old2@x.com', fullName: 'ilkay yildiz', phone: PHONE_B })],
      users: [user({ id: 'u1', name: 'Busra ISIK' }), user({ id: 'u2', email: 'u2@x.com', name: 'İlkay Yıldız', phone: '0 555 222 33 44' })],
    })
    expect(rows).toEqual([
      expect.objectContaining({ id: 'a1', verdict: 'relink', userId: 'u1', basis: 'name+phone' }),
      expect.objectContaining({ id: 'a2', verdict: 'relink', userId: 'u2', basis: 'name+phone' }),
    ])
  })

  it('DUPLICATE (never relinked) when the matched account already has an application under its current email', () => {
    const { rows, counts } = planRelink({
      apps: [
        app({ id: 'second', email: 'second@x.com', fullName: 'Busra Isik', phone: PHONE_A }),
        app({ id: 'in-input', email: 'third@x.com', fullName: 'Other Person', phone: PHONE_B }),
        app({ id: 'own', email: 'u2@x.com', fullName: 'Other Person', phone: PHONE_B }),
        app({ id: 'middle', email: 'fourth@x.com', fullName: 'Ayşe Nur Yılmaz', phone: '+90 555 777 88 99' }),
      ],
      users: [
        user({ id: 'u1', name: 'Büşra Işık', hasLinkedApplication: true }),
        // Linked by an approved application in the same input, not by the flag.
        user({ id: 'u2', email: 'U2@x.com', name: 'Other Person', phone: PHONE_B }),
        user({ id: 'u3', email: 'u3@x.com', name: 'Ayse Yilmaz', phone: '05557778899', hasLinkedApplication: true }),
      ],
    })
    expect(rows).toEqual([
      { id: 'second',   verdict: 'duplicate', userId: 'u1', basis: 'name+phone' },
      { id: 'in-input', verdict: 'duplicate', userId: 'u2', basis: 'name+phone' },
      { id: 'middle',   verdict: 'duplicate', userId: 'u3', basis: 'first+last name+phone' },
    ])
    expect(counts).toMatchObject({ relink: 0, duplicate: 3, ambiguous: 0, linked: 1 })
  })

  it('first+last name with phone never relinks an account that has no application — AMBIGUOUS', () => {
    const { rows } = planRelink({
      apps:  [app({ id: 'a1', fullName: 'Ayşe Nur Yılmaz' })],
      users: [user({ id: 'u1', name: 'Ayse Yilmaz' })],
    })
    expect(rows).toEqual([{ id: 'a1', verdict: 'ambiguous', basis: 'first+last name+phone (middle names differ)', candidates: ['u1'] }])
  })

  it('relinks on phone + approval timing when the name has changed since', () => {
    const { rows, counts } = planRelink({
      apps:  [app({ id: 'a1', fullName: 'Jane Smith' }), app({ id: 'edge', email: 'edge@x.com', fullName: 'Someone', phone: PHONE_B })],
      users: [
        user({ id: 'u1', email: 'now@x.com', joinedAt: at(40_000) }),
        user({ id: 'u2', email: 'u2@x.com', name: 'Else', phone: PHONE_B, joinedAt: at(APPROVAL_TIMING_WINDOW_MS) }),
      ],
    })
    expect(rows).toEqual([
      { id: 'a1',   verdict: 'relink', userId: 'u1', basis: 'phone+approval-timing', seenEmail: 'old@x.com', newEmail: 'now@x.com' },
      { id: 'edge', verdict: 'relink', userId: 'u2', basis: 'phone+approval-timing', seenEmail: 'edge@x.com', newEmail: 'u2@x.com' },
    ])
    expect(counts).toMatchObject({ relink: 2 })
  })

  it('no timing proof — AMBIGUOUS — outside 5 minutes, before approval, with no reviewedAt, when the account has an application, or when the phone or name points elsewhere', () => {
    const phoneOnly = { verdict: 'ambiguous', basis: 'phone only (name differs)', candidates: ['u1'] }
    const plan = (a: Partial<RelinkApplication>, users: RelinkUser[]) => planRelink({ apps: [app({ fullName: 'Jane Smith', ...a })], users }).rows
    expect(plan({}, [user({ id: 'u1', joinedAt: at(APPROVAL_TIMING_WINDOW_MS + 1) })])).toEqual([{ id: 'a', ...phoneOnly }])
    expect(plan({}, [user({ id: 'u1', joinedAt: at(-1) })])).toEqual([{ id: 'a', ...phoneOnly }])
    expect(plan({ reviewedAt: null }, [user({ id: 'u1', joinedAt: at(1000) })])).toEqual([{ id: 'a', ...phoneOnly }])
    expect(plan({}, [user({ id: 'u1', joinedAt: at(1000), hasLinkedApplication: true })])).toEqual([{ id: 'a', ...phoneOnly }])
    // Phone shared by two accounts: not exactly one.
    expect(plan({}, [user({ id: 'u1', joinedAt: at(1000) }), user({ id: 'u2', email: 'u2@x.com', name: 'Other' })]))
      .toEqual([{ id: 'a', verdict: 'ambiguous', basis: 'phone only (name differs)', candidates: ['u1', 'u2'] }])
    // The name belongs to a different account.
    expect(plan({}, [user({ id: 'u1', joinedAt: at(1000) }), user({ id: 'u2', email: 'u2@x.com', name: 'Jane Smith', phone: PHONE_B })]))
      .toEqual([{ id: 'a', verdict: 'ambiguous', basis: 'name and phone match different accounts', candidates: ['u2', 'u1'] }])
  })

  it('a phone with too few digits does not count — not for name+phone, not for timing', () => {
    const { rows } = planRelink({
      apps:  [app({ id: 'a1', phone: '555 12 34' }), app({ id: 'a2', email: 'b@x.com', fullName: 'Jane Smith', phone: '5551234' })],
      users: [user({ id: 'u1', phone: '5551234', joinedAt: at(1000) })],
    })
    expect(rows).toEqual([{ id: 'a1', verdict: 'ambiguous', basis: 'name only (application has no phone)', candidates: ['u1'] }])
  })

  it('never touches an application whose email matches ANY user, or a tombstone', () => {
    const { rows, counts } = planRelink({
      apps: [
        app({ id: 'linked', email: 'U1@x.com' }),
        app({ id: 'banned-match', email: 'gone@x.com' }),
        app({ id: 'tomb', email: 'deleted_ab@deleted.smileys' }),
      ],
      users: [
        user({ id: 'u1', email: 'u1@x.com' }),
        user({ id: 'b', email: 'gone@x.com', status: 'banned' }),
        user({ id: 'live', email: 'live@x.com' }),
      ],
    })
    expect(rows).toEqual([])
    expect(counts).toMatchObject({ linked: 2, tombstones: 1 })
  })

  it('AMBIGUOUS when several accounts match both', () => {
    const { rows } = planRelink({ apps: [app({ id: 'a1' })], users: [user({ id: 'u1' }), user({ id: 'u2', email: 'u2@x.com' })] })
    expect(rows).toEqual([expect.objectContaining({ id: 'a1', verdict: 'ambiguous', candidates: ['u1', 'u2'] })])
  })

  it('AMBIGUOUS when two applications would relink onto the same account', () => {
    const { rows, counts } = planRelink({
      apps:  [app({ id: 'a1' }), app({ id: 'a2', email: 'older@x.com', phone: PHONE_A })],
      users: [user({ id: 'u1' })],
    })
    expect(rows).toEqual([
      { id: 'a1', verdict: 'ambiguous', basis: 'name+phone, but 2 applications relink to this account', candidates: ['u1'] },
      { id: 'a2', verdict: 'ambiguous', basis: 'name+phone, but 2 applications relink to this account', candidates: ['u1'] },
    ])
    expect(counts).toMatchObject({ relink: 0, ambiguous: 2 })
  })

  it('AMBIGUOUS when only the name or only the phone matches, or they point at different accounts', () => {
    const { rows, counts } = planRelink({
      apps: [
        app({ id: 'name-only',  phone: '+90 599 999 99 99' }),
        app({ id: 'no-phone',   phone: null }),
        app({ id: 'phone-only', fullName: 'Someone Else', phone: PHONE_B }),
        app({ id: 'split',      fullName: 'Jane Doe',     phone: PHONE_B }),
      ],
      users: [user({ id: 'u1' }), user({ id: 'u2', email: 'u2@x.com', name: 'Other Person', phone: PHONE_B })],
    })
    const by = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(rows.every(r => r.verdict === 'ambiguous')).toBe(true)
    expect(by['name-only']).toMatchObject({ basis: 'name only (phone differs)', candidates: ['u1'] })
    expect(by['no-phone']).toMatchObject({ basis: 'name only (application has no phone)', candidates: ['u1'] })
    expect(by['phone-only']).toMatchObject({ basis: 'phone only (name differs)', candidates: ['u2'] })
    expect(by['split']).toMatchObject({ basis: 'name and phone match different accounts', candidates: ['u1', 'u2'] })
    expect(counts).toMatchObject({ relink: 0, duplicate: 0, ambiguous: 4 })
  })

  it('banned and self-deleted accounts are not candidates; a NULL banReason is live', () => {
    expect(isLiveUser({ status: 'approved', banReason: null, email: 'a@x.com' })).toBe(true)
    expect(isLiveUser({ status: 'banned',   banReason: 'spam', email: 'a@x.com' })).toBe(false)
    expect(isLiveUser({ status: 'approved', banReason: 'deleted', email: 'a@x.com' })).toBe(false)
    expect(isLiveUser({ status: 'approved', banReason: null, email: 'deleted_1@deleted.smileys' })).toBe(false)

    const { rows, counts } = planRelink({
      apps:  [app({ id: 'a1' })],
      users: [user({ id: 'b', email: 'b@x.com', status: 'banned' }), user({ id: 'd', email: 'deleted_x@deleted.smileys', status: 'banned', banReason: 'deleted' })],
    })
    expect(rows).toEqual([])
    expect(counts.unmatched).toBe(1)
  })
})
