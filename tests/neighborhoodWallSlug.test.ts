import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session',  () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/mentions', () => ({ notifyMentions: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/city',     () => ({ resolveCityId: vi.fn().mockResolvedValue('izmir') }))
vi.mock('@/lib/neighborhoodsDb', () => ({ resolveNeighborhoodBySlug: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  neighborhoodPost:      { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  neighborhoodPostLike:  { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  neighborhoodPostReply: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
} }))

import { POST as like } from '@/app/api/neighborhoods/[slug]/posts/[postId]/like/route'
import { GET as listReplies, POST as reply } from '@/app/api/neighborhoods/[slug]/posts/[postId]/replies/route'
import { GET as listPosts, POST as createPost } from '@/app/api/neighborhoods/[slug]/posts/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { resolveNeighborhoodBySlug } from '@/lib/neighborhoodsDb'

// The wall stores a neighborhood by display name ("Kadıköy") and the client
// addresses it by URL slug ("kadikoy"). The IDOR guard on likes and replies
// compared the two raw, so every like and every reply 404'd — no Istanbul
// name equals its own slug. Listing and posting resolved the slug through the
// Istanbul-only constant, so every other city's wall was dead on arrival.

const p = prisma as any
const req = (body: any = {}, url = 'http://x/app/api/x') => ({ json: async () => body, nextUrl: new URL(url) }) as any
const postParams = { params: Promise.resolve({ slug: 'kadikoy', postId: 'p1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'U', role: 'member', cityId: 'izmir' })
  p.neighborhoodPost.findUnique.mockResolvedValue({ id: 'p1', neighborhood: 'Kadıköy', cityId: 'istanbul' })
  p.neighborhoodPostLike.findUnique.mockResolvedValue(null)
  p.neighborhoodPostLike.create.mockResolvedValue({})
  p.neighborhoodPostReply.create.mockResolvedValue({ id: 'r1', content: 'x', createdAt: new Date(), user: { id: 'u1', name: 'U', color: '', profilePhoto: null, role: 'member' } })
})

describe('likes and replies match the slug against the stored name', () => {
  it('likes a post whose name slugifies to the URL slug', async () => {
    const res = await like(req({ emoji: '❤️' }), postParams)
    expect(res.status).not.toBe(404)
    expect(p.neighborhoodPostLike.create).toHaveBeenCalled()
  })
  it('lists and posts replies on it', async () => {
    expect((await listReplies(req(), postParams)).status).toBe(200)
    expect((await reply(req({ content: 'hi' }), postParams)).status).toBe(201)
  })
  it('still refuses a post from another neighborhood', async () => {
    p.neighborhoodPost.findUnique.mockResolvedValue({ id: 'p1', neighborhood: 'Moda', cityId: 'istanbul' })
    expect((await like(req({ emoji: '❤️' }), postParams)).status).toBe(404)
    expect((await reply(req({ content: 'hi' }), postParams)).status).toBe(404)
  })
})

describe('listing and posting resolve the slug per city', () => {
  const params = { params: Promise.resolve({ slug: 'alsancak' }) }

  it('reads the wall through the city registry and scopes the query to that city', async () => {
    ;(resolveNeighborhoodBySlug as any).mockResolvedValue({ cityId: 'izmir', view: { name: 'Alsancak', slug: 'alsancak' } })
    const res = await listPosts(req({}, 'http://x/app/api/neighborhoods/alsancak/posts'), params)
    expect(res.status).toBe(200)
    expect(resolveNeighborhoodBySlug).toHaveBeenCalledWith('alsancak', 'izmir')
    expect(p.neighborhoodPost.findMany.mock.calls[0][0].where).toEqual({ neighborhood: 'Alsancak', cityId: 'izmir' })
  })

  it('stores the resolved name and city on a new post', async () => {
    ;(resolveNeighborhoodBySlug as any).mockResolvedValue({ cityId: 'izmir', view: { name: 'Alsancak', slug: 'alsancak' } })
    p.neighborhoodPost.create.mockResolvedValue({ id: 'p2', content: 'hi', imageUrl: null, createdAt: new Date(), user: { id: 'u1', name: 'U', color: '', profilePhoto: null, role: 'member' } })
    const res = await createPost(req({ content: 'hi' }), params)
    expect(res.status).toBe(201)
    expect(p.neighborhoodPost.create.mock.calls[0][0].data).toMatchObject({ neighborhood: 'Alsancak', cityId: 'izmir' })
  })

  it('404s a slug no public city knows', async () => {
    ;(resolveNeighborhoodBySlug as any).mockResolvedValue(null)
    expect((await listPosts(req({}, 'http://x/app/api/neighborhoods/nowhere/posts'), params)).status).toBe(404)
  })
})
