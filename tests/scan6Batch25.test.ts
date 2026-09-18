import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sixth scan, batch 25 — self-deletion left the member's words on their
// business claims. The claim `message` is free-text ownership proof ("call me
// on +90 …", "I'm Jane Doe, owner — jane@cafe.com") and the admin Claims tab
// renders it verbatim, so it outlived the erasure. BusinessClaim has no other
// contact / proof-URL column; `message` is NOT NULL, so it is neutralised
// rather than nulled, and the row keeps status, business and reviewer stamps.

const h = vi.hoisted(() => {
  const calls: Record<string, any[]> = {}
  const results: Record<string, any> = {}
  // Every call in order, tagged with whether it ran inside $transaction.
  const log: { key: string; inTx: boolean }[] = []
  let inTx = false
  const model = (m: string) => new Proxy({}, { get: (_t, method: string) => (...args: any[]) => {
    const key = `${m}.${method}`
    ;(calls[key] ??= []).push(args[0])
    log.push({ key, inTx })
    if (key in results) return Promise.resolve(typeof results[key] === 'function' ? results[key](args[0]) : results[key])
    if (method === 'count') return Promise.resolve(0)
    if (method === 'findMany' || method === 'groupBy') return Promise.resolve([])
    if (method === 'findUnique' || method === 'findFirst') return Promise.resolve(null)
    if (method === 'deleteMany' || method === 'updateMany' || method === 'createMany') return Promise.resolve({ count: 0 })
    return Promise.resolve({})
  } })
  const prisma: any = new Proxy({}, { get: (_t, m: string) =>
    m === '$transaction' ? async (ops: any) => {
      inTx = true
      try { return await (typeof ops === 'function' ? ops(prisma) : Promise.all(ops)) } finally { inTx = false }
    }
    : m === '$queryRaw' || m === '$queryRawUnsafe' ? () => Promise.resolve([])
    : model(m) })
  return { prisma, calls, results, log, getSession: vi.fn() }
})

vi.mock('@/lib/prisma',            () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',           () => ({ getSession: h.getSession, deleteSession: vi.fn(async () => {}) }))
vi.mock('@/lib/notify',            () => ({ createNotification: vi.fn(async () => true) }))
vi.mock('@/lib/rateLimit',         () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true) }))
vi.mock('@/lib/audit',             () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/admin/userHistory', () => ({ snapshotUserHistory: vi.fn(async () => ({})) }))
vi.mock('@/lib/spotsLeft',         () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/city',              () => ({ todayInCity: vi.fn(async () => '2026-09-15'), resolveCityId: vi.fn(async () => 'c-ist'), resolveTargetCityId: vi.fn() }))
vi.mock('bcryptjs',                () => ({ default: { compare: vi.fn(async () => true) } }))

import { POST as deleteAccountPOST } from '@/app/api/auth/delete-account/route'

const jsonReq = (body: any = {}) => ({ json: async () => body }) as any
const reviewedAt = new Date('2026-08-01T10:00:00Z')

// A stand-in claims table: updateMany applies its data to rows matching
// every scalar in `where`, so "other members untouched" is observed, not
// inferred from the filter shape.
type Claim = { id: string; businessId: string; claimantId: string; message: string; status: string; reviewedById: string | null; reviewedAt: Date | null; createdAt: Date }
let claims: Claim[]
const seedClaims = (): Claim[] => [
  { id: 'cl1', businessId: 'b-cafe',   claimantId: 'u1', message: 'I own it, call me +90 555 111 2233 or jane@cafe.com', status: 'approved', reviewedById: 'a1', reviewedAt, createdAt: new Date('2026-07-30') },
  { id: 'cl2', businessId: 'b-bar',    claimantId: 'u1', message: 'Jane Doe, name on the lease',                          status: 'pending',  reviewedById: null, reviewedAt: null, createdAt: new Date('2026-09-01') },
  { id: 'cl3', businessId: 'b-bar',    claimantId: 'u2', message: 'Ali here, +90 532 000 0000',                           status: 'rejected', reviewedById: 'a1', reviewedAt, createdAt: new Date('2026-08-20') },
]

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(h.calls)) delete h.calls[k]
  for (const k of Object.keys(h.results)) delete h.results[k]
  h.log.length = 0
  claims = seedClaims()
  h.getSession.mockResolvedValue({ id: 'u1', name: 'Jane Doe', role: 'member', cityId: 'c-ist' })
  h.results['user.findUnique'] = { password: 'hash', status: 'approved', name: 'Jane Doe', email: 'jane@example.com', phone: '+90 555', lastFingerprint: 'fp' }
  h.results['businessClaim.updateMany'] = (args: any) => {
    const hit = claims.filter(c => Object.entries(args.where).every(([k, v]) => (c as any)[k] === v))
    for (const c of hit) Object.assign(c, args.data)
    return { count: hit.length }
  }
})

describe('self-deletion scrubs the member\'s business claim messages', () => {
  it('neutralises the message inside the deletion transaction', async () => {
    const res = await deleteAccountPOST(jsonReq({ password: 'pw' }))
    expect(res.status).toBe(200)
    // Two writes in the transaction: the scrub, then pending claims rejected
    // (approving one later gave the business to a deleted account).
    const scrubs = h.log.filter(l => l.key === 'businessClaim.updateMany')
    expect(scrubs).toEqual([{ key: 'businessClaim.updateMany', inTx: true }, { key: 'businessClaim.updateMany', inTx: true }])
    expect(h.calls['businessClaim.updateMany'][1]).toEqual({ where: { claimantId: 'u1', status: 'pending' }, data: { status: 'rejected' } })
    // Same transaction as the user-row anonymisation, before it.
    const userUpdate = h.log.findIndex(l => l.key === 'user.update')
    expect(h.log[userUpdate].inTx).toBe(true)
    expect(h.log.findIndex(l => l.key === 'businessClaim.updateMany')).toBeLessThan(userUpdate)
    expect(h.calls['businessClaim.updateMany'][0]).toEqual({ where: { claimantId: 'u1' }, data: { message: '[deleted]' } })
  })

  it('keeps status, business, dates and reviewer; no claim row is deleted', async () => {
    await deleteAccountPOST(jsonReq({ password: 'pw' }))
    const before = seedClaims()
    for (const id of ['cl1', 'cl2']) {
      const now = claims.find(c => c.id === id)!
      const was = before.find(c => c.id === id)!
      expect(now.message).toBe('[deleted]')
      expect(now.message).not.toMatch(/\+90|@|Jane/)
      // A pending claim is closed as rejected; everything else stays.
      const status = was.status === 'pending' ? 'rejected' : was.status
      expect({ ...now, message: was.message }).toEqual({ ...was, status })
    }
    expect(h.calls['businessClaim.deleteMany']).toBeUndefined()
    expect(h.calls['businessClaim.delete']).toBeUndefined()
  })

  it('leaves other members\' claims untouched', async () => {
    await deleteAccountPOST(jsonReq({ password: 'pw' }))
    expect(claims.find(c => c.id === 'cl3')).toEqual(seedClaims().find(c => c.id === 'cl3'))
  })

  it('releases businesses the member owned, in the same transaction, touching nothing else on them', async () => {
    // Left on a deleted account a business could not be claimed by anyone else
    // and its reviews had nobody to answer them. The business contact details
    // belong to the business, so only the two ownership columns change.
    await deleteAccountPOST(jsonReq({ password: 'pw' }))
    const releases = h.log.filter(l => l.key === 'business.updateMany')
    expect(releases).toEqual([{ key: 'business.updateMany', inTx: true }])
    expect(h.calls['business.updateMany'][0]).toEqual({ where: { claimedById: 'u1' }, data: { claimedById: null, claimedAt: null } })
    expect(h.calls['business.update']).toBeUndefined()
    expect(h.calls['business.delete']).toBeUndefined()
    expect(h.calls['business.deleteMany']).toBeUndefined()
  })

  it('a wrong password scrubs nothing', async () => {
    const bcrypt = (await import('bcryptjs')).default as any
    bcrypt.compare.mockResolvedValueOnce(false)
    const res = await deleteAccountPOST(jsonReq({ password: 'nope' }))
    expect(res.status).toBe(403)
    expect(h.calls['businessClaim.updateMany']).toBeUndefined()
    expect(claims).toEqual(seedClaims())
  })
})
