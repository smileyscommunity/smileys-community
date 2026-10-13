import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn(), findUser = vi.fn(), findOffer = vi.fn()
vi.mock('@/lib/session', () => ({ getSession: () => getSession() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: async () => true }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findFirst: (a: unknown) => findUser(a) }, postMemberOffer: { findFirst: (a: unknown) => findOffer(a) } } }))

import { GET } from '@/app/api/posts/[slug]/offer/route'
const call = () => GET(new Request('http://x') as never, { params: Promise.resolve({ slug: 's' }) })
const OFFER = { label: '15% off', url: 'https://private.example.com/x', code: 'C15', note: null }

beforeEach(() => { getSession.mockReset(); findUser.mockReset(); findOffer.mockReset() })

describe('GET /api/posts/[slug]/offer', () => {
  it('404s a signed-out visitor without touching the offer table', async () => {
    getSession.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(findOffer).not.toHaveBeenCalled()
  })
  it('404s a signed-in account that is not an activated approved member', async () => {
    getSession.mockResolvedValue({ id: 'u1' }); findUser.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(findOffer).not.toHaveBeenCalled()
  })
  it('serves the offer to an activated member, uncached, only for a published community story', async () => {
    getSession.mockResolvedValue({ id: 'u1' }); findUser.mockResolvedValue({ id: 'u1' }); findOffer.mockResolvedValue(OFFER)
    const r = await call()
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect(await r.json()).toMatchObject({ code: 'C15' })
    expect(findOffer.mock.calls[0][0].where).toMatchObject({ active: true, post: { status: 'published', kind: 'community' } })
  })
  it('gives the same 404 when the article has no offer', async () => {
    getSession.mockResolvedValue({ id: 'u1' }); findUser.mockResolvedValue({ id: 'u1' }); findOffer.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })
})
