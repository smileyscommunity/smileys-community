import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sixth scan, batch 18 — two low-severity leaks.
//   23. self-deletion cleared a listing's description and photo but kept its
//       title, phone/WhatsApp `contact` and `contactEmail`, which staff listing
//       views still return; the gallery, a hangout's and a moving sale's photo
//       survived too
//   31. @mentions: foldName equates Çağla/Cagla and Işık/Isik, but the DB
//       prefilter is only case-insensitive, so "@Cagla" never loaded the Çağla
//       row; and admin-hidden accounts could be mentioned (wall and club)

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
    if (method === 'deleteMany' || method === 'updateMany' || method === 'createMany') return Promise.resolve({ count: 0 })
    return Promise.resolve({})
  } })
  const prisma: any = new Proxy({}, { get: (_t, m: string) =>
    m === '$transaction' ? (ops: any) => (typeof ops === 'function' ? ops(prisma) : Promise.all(ops))
    : m === '$queryRaw' || m === '$queryRawUnsafe' ? (...args: any[]) => {
      ;(calls[m] ??= []).push(args[0])
      return Promise.resolve(m in results ? (typeof results[m] === 'function' ? results[m](args[0]) : results[m]) : [])
    }
    : model(m) })
  return { prisma, calls, results, getSession: vi.fn(), createNotification: vi.fn(async () => true) }
})

vi.mock('@/lib/prisma',            () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',           () => ({ getSession: h.getSession, deleteSession: vi.fn(async () => {}) }))
vi.mock('@/lib/notify',            () => ({ createNotification: h.createNotification }))
vi.mock('@/lib/rateLimit',         () => ({ rateLimit: vi.fn(async () => true), claimOnce: vi.fn(async () => true) }))
vi.mock('@/lib/audit',             () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/admin/userHistory', () => ({ snapshotUserHistory: vi.fn(async () => ({})) }))
vi.mock('@/lib/spotsLeft',         () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/city',              () => ({ todayInCity: vi.fn(async () => '2026-09-15'), resolveCityId: vi.fn(async () => 'c-ist'), resolveTargetCityId: vi.fn() }))
vi.mock('bcryptjs',                () => ({ default: { compare: vi.fn(async () => true) } }))

import { POST as deleteAccountPOST } from '@/app/api/auth/delete-account/route'
import { POST as clubPostPOST } from '@/app/api/clubs/[slug]/posts/route'
import { notifyMentions, mentionPatterns, MAX_RECIPIENTS } from '@/lib/mentions'
import { runMentionSql, parseMentionSql } from './helpers/mentionSql'

const last = (key: string) => h.calls[key]?.at(-1)
const jsonReq = (body: any = {}) => ({ json: async () => body }) as any
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }
const notified = () => h.createNotification.mock.calls.map((c: any[]) => c[0]).sort()

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(h.calls)) delete h.calls[k]
  for (const k of Object.keys(h.results)) delete h.results[k]
})

// ── 23. self-deletion scrubs the listing's contact columns ─────────────────
describe('23. a deleted member leaves no contact on their listings', () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue({ id: 'u1', name: 'Jane Doe', role: 'member', cityId: 'c-ist' })
    h.results['user.findUnique'] = { password: 'hash', status: 'approved', name: 'Jane Doe', email: 'jane@example.com', phone: '+90 555', lastFingerprint: 'fp' }
  })

  it('clears contact, contactEmail, the title and the gallery; the row stays, expired', async () => {
    const res = await deleteAccountPOST(jsonReq({ password: 'pw' }))
    expect(res.status).toBe(200)
    const listing = last('listing.updateMany')
    expect(listing.where).toEqual({ userId: 'u1' })
    expect(listing.data).toMatchObject({
      title: 'Removed listing', description: '[deleted]', photo: null, photos: [],
      contact: null, contactEmail: null, status: 'expired',
    })
    // Not a delete: saved-by rows and staff history keep their parent.
    expect(h.calls['listing.deleteMany']).toBeUndefined()
  })

  it('also drops the photo on hangouts and moving sales', async () => {
    await deleteAccountPOST(jsonReq({ password: 'pw' }))
    expect(last('hangout.updateMany').data).toMatchObject({ photo: null, description: null, location: 'Removed' })
    expect(last('movingSale.updateMany').data).toEqual({ note: null, photo: null })
  })
})

// ── 31. mentions reach accent variants, never hidden accounts ─────────────
// The wall lookup is raw SQL since scan 6 batch 26; tests/helpers/mentionSql
// runs it against this table the way Postgres would (translate + LIKE, and
// only the scope predicates the query really has).
const USERS = [
  { id: 'u-cagla',  name: 'Çağla Öz',     status: 'approved', hiddenFromMembers: false, cityId: 'c1' },
  { id: 'u-isik',   name: 'Işık Tan',     status: 'approved', hiddenFromMembers: false, cityId: 'c1' },
  { id: 'u-ayse',   name: 'Ayşe Kaya',    status: 'approved', hiddenFromMembers: false, cityId: 'c1' },
  { id: 'u-ayla',   name: 'Ayla Demir',   status: 'approved', hiddenFromMembers: false, cityId: 'c1' },
  { id: 'u-aylin',  name: 'Aylin',        status: 'approved', hiddenFromMembers: false, cityId: 'c1' },
  { id: 'u-kubra',  name: 'H. Kübra Çulha', status: 'approved', hiddenFromMembers: false, cityId: 'c1' },
  { id: 'u-hidden', name: 'Deniz Staff',  status: 'approved', hiddenFromMembers: true,  cityId: 'c1' },
  { id: 'u-gone',   name: 'Deniz',        status: 'banned',   hiddenFromMembers: false, cityId: 'c1' },
  { id: 'u-deniz',  name: 'Deniz Ak',     status: 'approved', hiddenFromMembers: false, cityId: 'c1' },
  { id: 'u-other',  name: 'Çağla Başka',  status: 'approved', hiddenFromMembers: false, cityId: 'c2' },
]
const findUsers = (q: any) => runMentionSql(q, USERS)

describe('31. wall mentions', () => {
  const post = (content: string) => notifyMentions({ content, authorId: 'me', authorName: 'Me', cityId: 'c1', link: '/neighborhoods/moda' })
  beforeEach(() => { h.results['$queryRaw'] = findUsers })

  it('"@Cagla" and "@Isik" reach Çağla and Işık', async () => {
    expect(await post('selam @Cagla ve @Isik')).toBe(2)
    expect(notified()).toEqual(['u-cagla', 'u-isik'])
  })

  it('the other direction and all-caps typing reach them too', async () => {
    expect(await post('@ÇAĞLA @IŞIK')).toBe(2)
    expect(notified()).toEqual(['u-cagla', 'u-isik'])
  })

  it('a hidden account is not mentioned, nor a banned (deleted) one', async () => {
    expect(await post('@Deniz')).toBe(1)
    expect(notified()).toEqual(['u-deniz'])
    const q = parseMentionSql(last('$queryRaw'))
    expect(q.text).toContain(`status = 'approved'`)
    expect(q.text).toContain(`"hiddenFromMembers" = false`)
  })

  it('"@Ayşe" still does not fan out to Ay… names, "@Ayse" neither', async () => {
    expect(await post('hey @Ayşe')).toBe(1)
    expect(notified()).toEqual(['u-ayse'])
    vi.clearAllMocks()
    expect(await post('hey @Ayse')).toBe(1)
    expect(notified()).toEqual(['u-ayse'])
    // Every pattern is a whole word, never the bare prefix.
    expect(parseMentionSql(last('$queryRaw')).folded).toEqual(['ayse', 'ayse %', '% ayse %', '% ayse'])
  })

  it('keeps the given-name match after a leading initial', async () => {
    expect(await post('@Kubra')).toBe(1)
    expect(notified()).toEqual(['u-kubra'])
  })

  it('stays in the post city and under the recipient cap', async () => {
    await post('@Cagla')
    expect(notified()).toEqual(['u-cagla'])
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, name: 'Cagla' }))
    h.results['$queryRaw'] = many
    vi.clearAllMocks()
    expect(await post('@Çağla')).toBe(MAX_RECIPIENTS)
  })

  it('the prefilter is bounded: four whole-word patterns per spelling, however many foldable letters', () => {
    // The per-letter variant list (2^n spellings, cut to a prefix past 32)
    // was replaced by folding the stored name in SQL (scan 6 batch 26).
    expect(mentionPatterns(['Çağla']).folded).toEqual(['cagla', 'cagla %', '% cagla %', '% cagla'])
    expect(mentionPatterns(['Constantinos']).folded).toHaveLength(4)
  })
})

describe('31. club wall mentions skip hidden and banned members', () => {
  it('only visible, approved members are loaded and notified', async () => {
    h.getSession.mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin', cityId: 'c-ist' })
    h.results['club.findUnique'] = { id: 'k1', name: 'Hikers', cityId: 'c-ist', isActive: true }
    h.results['clubPost.create'] = {
      id: 'post1', content: '@Deniz @Cagla', type: 'post', createdAt: new Date(),
      user: { id: 'a1', name: 'Admin', color: '#000', profilePhoto: null, role: 'admin' },
    }
    h.results['clubMembership.findMany'] = (args: any) => USERS
      .filter(u => u.id !== args.where.userId?.not)
      .filter(u => !args.where.user || ((args.where.user.status === undefined || u.status === args.where.user.status)
        && (args.where.user.hiddenFromMembers === undefined || u.hiddenFromMembers === args.where.user.hiddenFromMembers)))
      .map(u => ({ userId: u.id, user: { id: u.id, name: u.name } }))
    const res = await clubPostPOST(jsonReq({ content: '@Deniz @Cagla' }), { params: Promise.resolve({ slug: 'hikers' }) })
    expect(res.status).toBe(200)
    await flush()
    const mentioned = h.createNotification.mock.calls.filter((c: any[]) => c[1] === 'club_mention').map((c: any[]) => c[0]).sort()
    expect(mentioned).toEqual(['u-cagla', 'u-deniz', 'u-other'])
  })
})
