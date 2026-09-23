import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Sixth scan, batch 2 — the nightly token sweep (lib/hygieneSweeps, started
// 2026-09-14) deleted every PasswordResetToken a day after expiry. Activation
// links live in that table, and an expired one is what /activate answers 410
// for and /activate/resend looks the member up by. A never-activated member
// opening a 7-day link on day 9 hit "invalid" and a dead end. Now an unused
// token whose account can still activate (approved, no password) is kept for
// 120 days past expiry; everything else keeps the 1-day rule.

const h = vi.hoisted(() => {
  const calls: Record<string, any[]> = {}
  const db = { tokens: [] as any[], users: [] as any[] }
  // Applies the where shapes the sweep and routes build, the way Postgres would.
  const cmp = (v: any, c: any): boolean => {
    if (c === null || typeof c !== 'object' || c instanceof Date) return v === c || (v instanceof Date && c instanceof Date && v.getTime() === c.getTime())
    if ('lt' in c && !(v < c.lt)) return false
    if ('in' in c && !c.in.includes(v)) return false
    if ('notIn' in c && c.notIn.includes(v)) return false
    return true
  }
  const matches = (row: any, where: any = {}): boolean => Object.entries(where).every(([k, c]) =>
    k === 'OR' ? (c as any[]).some(o => matches(row, o)) : cmp(row[k], c))
  const table = (name: 'tokens' | 'users', model: string) => ({
    findMany: vi.fn(async (a: any) => { (calls[`${model}.findMany`] ??= []).push(a)
      const pick = (r: any) => a.select ? Object.fromEntries(Object.keys(a.select).map(k => [k, r[k] ?? null])) : r
      return db[name].filter(r => matches(r, a.where)).slice(0, a.take ?? Infinity).map(pick) }),
    deleteMany: vi.fn(async (a: any) => { (calls[`${model}.deleteMany`] ??= []).push(a)
      const before = db[name].length; db[name] = db[name].filter(r => !matches(r, a.where)); return { count: before - db[name].length } }),
    count: vi.fn(async (a: any) => db[name].filter(r => matches(r, a.where)).length),
    findUnique: vi.fn(async (a: any) => db[name].find(r => matches(r, a.where)) ?? null),
    create: vi.fn(async (a: any) => { db[name].push({ id: `new-${db[name].length}`, used: false, ...a.data }); return {} }),
  })
  const prisma: any = {
    passwordResetToken:     table('tokens', 'passwordResetToken'),
    user:                   table('users', 'user'),
    emailVerificationToken: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    memberConnection:       { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    // The sweep also reports approved applicants whose account never became
    // approved (2026-09-23). No fixture here — this file is about the token
    // sweep; tests/strandedApprovals2026.test.ts owns that check.
    memberApplication:      { findMany: vi.fn(async () => []) },
  }
  return { prisma, calls, db, sent: [] as any[] }
})

vi.mock('@/lib/prisma',         () => ({ prisma: h.prisma }))
vi.mock('@/lib/rateLimit',      () => ({ rateLimit: vi.fn(async () => true), getIp: () => '1.2.3.4' }))
vi.mock('@/lib/cronAuth',       () => ({ checkCronAuth: vi.fn(async () => null) }))
vi.mock('@/lib/cronHealth',     () => ({ recordCronRun: vi.fn(async () => {}) }))
vi.mock('@/lib/session',        () => ({ createSession: vi.fn(async () => {}) }))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/email',          () => ({ sendNewActivationLinkEmail: vi.fn(async (...a: any[]) => { h.sent.push(a) }) }))

import { deleteExpiredAuthTokens, HYGIENE_BATCH_SIZE, HYGIENE_MAX_BATCHES, ACTIVATION_TOKEN_GRACE_MS } from '@/lib/hygieneSweeps'
import { POST as nameHygienePOST } from '@/app/api/cron/sweep-name-hygiene/route'
import { GET as activateGET } from '@/app/api/auth/activate/route'
import { POST as resendPOST } from '@/app/api/auth/activate/resend/route'
import { hashToken } from '@/lib/tokenHash'

const NOW = new Date('2026-09-15T03:20:00Z')
const DAY = 86_400_000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
const tok = (id: string, userId: string, expiresAt: Date, used = false) => ({ id, userId, token: hashToken(`plain-${id}`), expiresAt, used })
const kept = () => h.db.tokens.map(t => t.id).sort()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  for (const k of Object.keys(h.calls)) delete h.calls[k]
  h.sent.length = 0
  h.db.users = [
    { id: 'u-never',     status: 'approved', password: null,   name: 'Jane Doe', email: 'jane@example.com' },
    { id: 'u-activated', status: 'approved', password: 'hash', name: 'A', email: 'a@x.com' },
    { id: 'u-banned',    status: 'banned',   password: null,   name: 'B', email: 'b@x.com' },
    { id: 'u-pending',   status: 'pending',  password: null,   name: 'P', email: 'p@x.com' },
  ]
  h.db.tokens = []
})
afterEach(() => { vi.useRealTimers() })

describe('the token sweep keeps links that can still lead to a new one', () => {
  it('keeps an expired activation link of a never-activated approved member; deletes the rest', async () => {
    h.db.tokens = [
      tok('never-day9',      'u-never',     ago(2)),     // 7-day link opened on day 9
      tok('never-day100',    'u-never',     ago(100)),
      tok('never-stale',     'u-never',     ago(121)),   // past the long grace
      tok('never-used',      'u-never',     ago(5), true),
      tok('never-fresh',     'u-never',     ago(-3)),    // not expired at all
      tok('activated',       'u-activated', ago(2)),     // spent activation / expired reset
      tok('reset-justnow',   'u-activated', ago(0.5)),   // inside the 1-day grace
      tok('banned',          'u-banned',    ago(2)),
      tok('pending',         'u-pending',   ago(2)),
      tok('deleted-account', 'u-gone',      ago(2)),     // user row removed
    ]
    const res = await deleteExpiredAuthTokens(NOW)
    expect(kept()).toEqual(['never-day100', 'never-day9', 'never-fresh', 'reset-justnow'])
    expect(res).toEqual({ passwordReset: 5, staleActivation: 1, activationKept: 2, emailVerification: 0 })
  })

  it('the delete where-clauses: 1-day rule except for activatable accounts; 120 days for those', async () => {
    h.db.tokens = [tok('activated', 'u-activated', ago(2)), tok('never-stale', 'u-never', ago(121))]
    await deleteExpiredAuthTokens(NOW)
    // Activatable = the resend route's own rule.
    expect(h.calls['user.findMany'][0]).toEqual({ where: { status: 'approved', password: null }, select: { id: true } })
    const dead  = { expiresAt: { lt: ago(1) }, OR: [{ userId: { notIn: ['u-never'] } }, { used: true }] }
    const stale = { expiresAt: { lt: new Date(NOW.getTime() - ACTIVATION_TOKEN_GRACE_MS) }, userId: { in: ['u-never'] }, used: false }
    const [first, second] = h.calls['passwordResetToken.deleteMany']
    expect(first.where).toEqual({ id: { in: ['activated'] }, ...dead })
    expect(second.where).toEqual({ id: { in: ['never-stale'] }, ...stale })
    expect(ACTIVATION_TOKEN_GRACE_MS).toBe(120 * DAY)
  })

  it('reset tokens keep the 1-day rule — reset has no resend-by-token path', async () => {
    h.db.tokens = [tok('reset-old', 'u-activated', ago(1.5)), tok('reset-new', 'u-activated', ago(0.5))]
    await deleteExpiredAuthTokens(NOW)
    expect(kept()).toEqual(['reset-new'])
  })

  it('batching and the nightly cap are unchanged, and kept rows never stall the loop', async () => {
    // Kept rows can't come back from the find (the where excludes them), so a
    // full batch of them can't make the loop spin on the same page.
    h.db.tokens = [
      ...Array.from({ length: HYGIENE_BATCH_SIZE }, (_, i) => tok(`keep${i}`, 'u-never', ago(3))),
      ...Array.from({ length: HYGIENE_BATCH_SIZE + 3 }, (_, i) => tok(`dead${i}`, 'u-activated', ago(3))),
    ]
    const res = await deleteExpiredAuthTokens(NOW)
    expect(res.passwordReset).toBe(HYGIENE_BATCH_SIZE + 3)
    expect(res.activationKept).toBe(HYGIENE_BATCH_SIZE)
    const deadFinds = h.calls['passwordResetToken.findMany'].filter(a => a.where.OR)
    expect(deadFinds).toHaveLength(2)   // a short batch ends the loop
    for (const f of deadFinds) expect(f.take).toBe(HYGIENE_BATCH_SIZE)

    // A backlog bigger than the cap still stops after HYGIENE_MAX_BATCHES.
    for (const k of Object.keys(h.calls)) delete h.calls[k]
    h.db.tokens = Array.from({ length: HYGIENE_BATCH_SIZE * (HYGIENE_MAX_BATCHES + 1) }, (_, i) => tok(`b${i}`, 'u-activated', ago(3)))
    const capped = await deleteExpiredAuthTokens(NOW)
    expect(capped.passwordReset).toBe(HYGIENE_BATCH_SIZE * HYGIENE_MAX_BATCHES)
    expect(h.calls['passwordResetToken.findMany'].filter(a => a.where.OR)).toHaveLength(HYGIENE_MAX_BATCHES)
    expect(h.db.tokens).toHaveLength(HYGIENE_BATCH_SIZE)
  }, 20_000)   // ~2.8s alone over the in-memory table; the default 5s timed out under full-suite load

  it('the cron reports the separate counts first', async () => {
    h.db.tokens = [tok('never-day9', 'u-never', ago(2)), tok('activated', 'u-activated', ago(2))]
    const body = await (await nameHygienePOST({} as any)).json()
    expect(body.expiredTokens).toEqual({ passwordReset: 1, staleActivation: 0, activationKept: 1, emailVerification: 0 })
    expect(Object.keys(body).slice(0, 3)).toEqual(['ok', 'expiredTokens', 'staleConnectionRequests'])
  })
})

describe('after the sweep, an old kept link still offers a new one', () => {
  const get = (plain: string) => activateGET(new NextRequest(`http://localhost/app/api/auth/activate?token=${plain}`))

  it('/activate says 410 expired for a 100-day-old kept link, and resend mails a fresh one', async () => {
    h.db.tokens = [tok('never-day100', 'u-never', ago(100)), tok('activated', 'u-activated', ago(2))]
    await deleteExpiredAuthTokens(NOW)

    const res = await get('plain-never-day100')
    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ expired: true })

    const r = await resendPOST(new NextRequest('http://localhost/app/api/auth/activate/resend', {
      method: 'POST', body: JSON.stringify({ token: 'plain-never-day100' }), headers: { 'content-type': 'application/json' },
    }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, email: 'j***@example.com' })
    expect(h.sent).toHaveLength(1)
  })

  it('a swept link is plain invalid (no resend offer) — the page points at forgot-password instead', async () => {
    h.db.tokens = [tok('activated', 'u-activated', ago(2))]
    await deleteExpiredAuthTokens(NOW)
    const res = await get('plain-activated')
    expect(res.status).toBe(400)
    expect((await res.json()).expired).toBeUndefined()
  })
})
