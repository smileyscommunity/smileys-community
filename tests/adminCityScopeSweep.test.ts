import { describe, it, expect, vi, beforeEach } from 'vitest'

// The 2026-09-03 sweep of every moderator-reachable admin route for
// server-side city scoping (docs/multi-city-next-steps.md §4). Lists must be
// pinned to the moderator's city whatever the query string says; row routes
// must refuse a cross-city target with 403; admins are untouched. Every case
// here was run against the unfixed routes first and failed there.
//
// One recording prisma mock serves every route: any model, any method,
// resolves to what the test set (default: empty list / null / count 0).

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',   () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn(async () => {}), notifyNewArticle: vi.fn(async () => {}) }))
vi.mock('@/lib/email',   () => ({ sendBroadcastEmail: vi.fn(), sendLoginNudgeEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), getIp: () => '127.0.0.1' }))
vi.mock('@/lib/survey',  () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()), aggregateRollup: vi.fn(() => null) }))
vi.mock('fs', async () => ({ ...(await vi.importActual<any>('fs')), writeFileSync: vi.fn() }))
vi.mock('@/lib/prisma', () => {
  const calls: Record<string, any[]> = {}
  const results: Record<string, any> = {}
  const model = (m: string) => new Proxy({}, { get: (_t, method: string) => (...args: any[]) => {
    const key = `${m}.${method}`
    ;(calls[key] ??= []).push(args[0])
    if (key in results) return Promise.resolve(typeof results[key] === 'function' ? results[key](args[0]) : results[key])
    if (method === 'count') return Promise.resolve(0)
    if (method === 'findMany' || method === 'groupBy') return Promise.resolve([])
    if (method === 'findUnique' || method === 'findFirst') return Promise.resolve(null)
    return Promise.resolve({})
  } })
  const prisma = new Proxy({}, { get: (_t, m: string) =>
    m === '$transaction' ? (ops: any) => (typeof ops === 'function' ? ops(prisma) : Promise.all(ops))
    : m === '$queryRaw' || m === '$queryRawUnsafe' ? () => Promise.resolve([])
    : m === '$executeRaw' || m === '$executeRawUnsafe' ? () => Promise.resolve(0)
    : model(m) })
  return { prisma, __calls: calls, __results: results }
})

import { getSession } from '@/lib/session'
import * as P from '@/lib/prisma'
import { GET as listingsGET }    from '@/app/api/admin/listings/route'
import { GET as movingGET }      from '@/app/api/admin/moving-sales/route'
import { GET as claimsGET }      from '@/app/api/admin/directory/claims/route'
import { GET as partnersGET }    from '@/app/api/admin/partners/route'
import { GET as broadcastGET }   from '@/app/api/admin/notifications/broadcast/route'
import { GET as clubsGET }       from '@/app/api/admin/clubs/route'
import { GET as postsGET }       from '@/app/api/admin/posts/route'
import { GET as testimonialsGET, PATCH as testimonialsReorder } from '@/app/api/admin/testimonials/route'
import { PATCH as partnerPATCH } from '@/app/api/admin/partners/[id]/route'
import { PUT as postPUT, DELETE as postDELETE } from '@/app/api/admin/posts/[id]/route'
import { GET as clubGET }        from '@/app/api/admin/clubs/[id]/route'
import { DELETE as testimonialDELETE } from '@/app/api/admin/testimonials/[id]/route'
import { POST as spotlightPOST } from '@/app/api/admin/spotlight/route'
import { POST as nudgePOST }     from '@/app/api/admin/tools/login-nudge/route'
import { GET as npsGET }         from '@/app/api/admin/nps/route'
import { GET as surveysGET }     from '@/app/api/admin/surveys/route'

const calls   = (P as any).__calls as Record<string, any[]>
const results = (P as any).__results as Record<string, any>
const last = (key: string) => calls[key]?.at(-1)
const req  = (url = 'http://x/app/api/admin/x', body: any = {}) => ({ url, nextUrl: new URL(url), json: async () => body }) as any
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const BODRUM = 'c-bodrum', ISTANBUL = 'c-istanbul'
const asModerator = () => (getSession as any).mockResolvedValue({ id: 'm1', name: 'Mod', role: 'moderator', cityId: BODRUM })
const asAdmin     = () => (getSession as any).mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin', cityId: ISTANBUL })

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(calls)) delete calls[k]
  for (const k of Object.keys(results)) delete results[k]
})

describe('lists a moderator can reach are pinned to their city', () => {
  it('listings — ?city= cannot widen a moderator; an admin may narrow', async () => {
    asModerator(); await listingsGET(req('http://x/a?city=c-istanbul&status=all'))
    expect(last('listing.findMany').where.cityId).toBe(BODRUM)
    asAdmin();     await listingsGET(req('http://x/a?city=c-izmir'))
    expect(last('listing.findMany').where.cityId).toBe('c-izmir')
    asAdmin();     await listingsGET(req('http://x/a'))
    expect(last('listing.findMany').where.cityId).toBeUndefined()
  })
  it('moving sales', async () => {
    asModerator(); await movingGET()
    expect(last('movingSale.findMany').where).toEqual({ cityId: BODRUM })
    asAdmin(); await movingGET()
    expect(last('movingSale.findMany').where).toEqual({})
  })
  it('directory claims — through the claimed business', async () => {
    asModerator(); await claimsGET(req('http://x/a?status=pending'))
    expect(last('businessClaim.findMany').where).toEqual({ status: 'pending', business: { cityId: BODRUM } })
  })
  it('partners', async () => {
    asModerator(); await partnersGET()
    expect(last('partner.findMany').where).toEqual({ cityId: BODRUM })
  })
  it('broadcast history — own city plus network-wide', async () => {
    asModerator(); await broadcastGET()
    expect(last('broadcast.findMany').where).toEqual({ OR: [{ cityId: BODRUM }, { cityId: null }] })
  })
  it('clubs — own city plus global, whatever ?city= says', async () => {
    asModerator(); await clubsGET(req('http://x/a?city=c-istanbul'))
    expect(last('club.findMany').where).toEqual({ OR: [{ cityId: BODRUM }, { cityId: null }] })
    asAdmin(); await clubsGET(req('http://x/a?city=global'))
    expect(last('club.findMany').where).toEqual({ cityId: null })
  })
  it('posts and testimonials — own city plus global', async () => {
    asModerator(); await postsGET()
    expect(last('post.findMany').where).toEqual({ OR: [{ cityId: BODRUM }, { cityId: null }] })
    await testimonialsGET()
    expect(last('testimonial.findMany').where).toEqual({ OR: [{ cityId: BODRUM }, { cityId: null }] })
  })
  it('surveys — every query through the event city, including the CSV', async () => {
    asModerator(); await surveysGET(req('http://x/a?format=csv'))
    const csv = last('eventSurvey.findMany').where
    expect(csv.event.is.cityId).toBe(BODRUM)
    const counts = calls['eventSurvey.count'].map(c => c.where?.event?.is?.cityId)
    expect(counts.every(c => c === BODRUM)).toBe(true)
  })
  it('NPS — through the responder, still anonymous', async () => {
    asModerator(); await npsGET(req('http://x/a?format=csv'))
    expect(last('memberNPS.findMany').where.user).toEqual({ cityId: BODRUM })
  })
  it('a moderator with no city fails closed everywhere', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'm2', name: 'Mod', role: 'moderator' })
    await movingGET()
    expect(last('movingSale.findMany').where).toEqual({ cityId: '__no_city__' })
  })
})

describe('row routes refuse a cross-city target', () => {
  it('partner PATCH', async () => {
    asModerator(); results['partner.findUnique'] = { cityId: ISTANBUL }
    expect((await partnerPATCH(req('http://x', { discount: '10%' }), params('p1'))).status).toBe(403)
    expect(calls['partner.update']).toBeUndefined()
    results['partner.findUnique'] = { cityId: BODRUM }
    expect((await partnerPATCH(req('http://x', { discount: '10%' }), params('p1'))).status).toBe(200)
  })
  it('post PUT and DELETE, and re-pinning to another city', async () => {
    asModerator()
    results['post.findUnique'] = { id: 'x', cityId: ISTANBUL, kind: 'community', category: 'stories', status: 'draft', title: 'T', excerpt: '', body: '', coverImage: null, slug: 's', authorId: 'a', publishedAt: null }
    expect((await postPUT(req('http://x', { title: 'T2' }), params('x'))).status).toBe(403)
    expect((await postDELETE(req(), params('x'))).status).toBe(403)
    expect(calls['post.delete']).toBeUndefined()
    results['post.findUnique'] = { id: 'x', cityId: BODRUM, kind: 'community', category: 'stories', status: 'draft', title: 'T', excerpt: '', body: '', coverImage: null, slug: 's', authorId: 'a', publishedAt: null }
    results['city.findUnique'] = { id: ISTANBUL }
    expect((await postPUT(req('http://x', { title: 'T', body: 'b', cityId: ISTANBUL }), params('x'))).status).toBe(403)
  })
  it('club GET — and audit meta stays admin-only', async () => {
    asModerator(); results['club.findUnique'] = { id: 'k', cityId: ISTANBUL }
    expect((await clubGET(req(), params('k'))).status).toBe(403)
    results['club.findUnique'] = { id: 'k', cityId: BODRUM, name: 'K' }
    expect((await clubGET(req(), params('k'))).status).toBe(200)
    expect(last('auditLog.findMany').select.meta).toBe(false)
  })
  it('testimonial DELETE, and a reorder containing a foreign quote', async () => {
    asModerator(); results['testimonial.findUnique'] = { memberName: 'x', role: null, quote: 'q', category: 'c', active: true, cityId: ISTANBUL }
    expect((await testimonialDELETE(req(), params('t1'))).status).toBe(403)
    results['testimonial.findMany'] = [{ cityId: BODRUM }, { cityId: ISTANBUL }]
    expect((await testimonialsReorder(req('http://x', { ids: ['t1', 't2'] }))).status).toBe(403)
    expect(calls['testimonial.update']).toBeUndefined()
  })
  it('spotlight — featuring another city\'s member', async () => {
    asModerator(); results['user.findUnique'] = { cityId: ISTANBUL, status: 'approved' }
    expect((await spotlightPOST(req('http://x', { userId: 'u9' }))).status).toBe(403)
  })
  it('login nudge — outbound mail reaches the moderator\'s own city only', async () => {
    asModerator(); await nudgePOST(req())
    expect(last('user.findMany').where.cityId).toBe(BODRUM)
    asAdmin(); await nudgePOST(req())
    expect(last('user.findMany').where.cityId).toBeUndefined()
  })
})
