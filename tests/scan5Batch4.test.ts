import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 16–20: spotlight, blocks on the dashboard, author identity on public APIs.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => ({
  businessReview: { findMany: vi.fn() },
  club:           { findUnique: vi.fn() },
  clubMembership: { findUnique: vi.fn() },
}))
const privacy = vi.hoisted(() => ({ restricted: new Set<string>() }))
const session = vi.hoisted(() => ({ current: null as { id: string; role: string } | null }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/access', () => ({ isAdmin: vi.fn(() => false), canActInCity: vi.fn(() => false) }))
vi.mock('@/lib/memberPrivacy', () => ({ restrictedSetFor: vi.fn(async () => privacy.restricted) }))

import { authorProjector } from '@/lib/authorProjection'
import { GET as reviewsGET } from '@/app/api/directory/[id]/reviews/route'
import { GET as spotlightGET } from '@/app/api/clubs/[slug]/spotlight/route'

const author = (id: string, name: string, vis = 'everyone') => ({ id, name, color: '#f00', profilePhoto: `/p/${id}.jpg`, profileVisibility: vis })

beforeEach(() => { vi.clearAllMocks(); privacy.restricted = new Set(); session.current = null })

describe('author projection (items 18–20)', () => {
  it('guests get a first name and colour, no photo, no member id', async () => {
    const project = await authorProjector(null, [author('u1', 'Ayşe Yılmaz')])
    expect(project(author('u1', 'Ayşe Yılmaz'))).toEqual({ id: 'member', name: 'Ayşe', color: '#f00', profilePhoto: null })
  })
  it('members see authors in full, except connections-only authors they are not connected to', async () => {
    privacy.restricted = new Set(['priv'])
    const project = await authorProjector({ id: 'me', role: 'member' } as never, [author('pub', 'Can Demir'), author('priv', 'Deniz Kaya', 'connections')])
    expect(project(author('pub', 'Can Demir'))).toEqual({ id: 'pub', name: 'Can Demir', color: '#f00', profilePhoto: '/p/pub.jpg' })
    expect(project(author('priv', 'Deniz Kaya', 'connections'))).toEqual({ id: 'priv', name: 'Deniz', color: '#f00', profilePhoto: null })
  })
})

describe('18. directory reviews API follows the business page rule', () => {
  const row = { id: 'r1', rating: 5, comment: 'Great', ownerReply: 'Thanks', ownerReplyAt: null, isHidden: false, createdAt: new Date(),
    author: author('u1', 'Ayşe Yılmaz'), ownerReplyBy: { id: 'o1', name: 'Mehmet Öz' } }
  const get = () => reviewsGET(new Request('http://x') as never, { params: Promise.resolve({ id: 'b1' }) })
  it('a guest gets first names, no photos, no member ids, and no privacy setting', async () => {
    p.businessReview.findMany.mockResolvedValue([row])
    const { reviews } = await (await get()).json()
    expect(reviews[0].author).toEqual({ id: 'member', name: 'Ayşe', color: '#f00', profilePhoto: null })
    expect(reviews[0].ownerReplyBy).toEqual({ id: 'member', name: 'Mehmet' })
    expect(JSON.stringify(reviews)).not.toContain('Yılmaz')
    expect(JSON.stringify(reviews)).not.toContain('profileVisibility')
  })
  it('a member sees full names', async () => {
    session.current = { id: 'me', role: 'member' }
    p.businessReview.findMany.mockResolvedValue([row])
    const { reviews } = await (await get()).json()
    expect(reviews[0].author.name).toBe('Ayşe Yılmaz')
  })
})

describe('19. board posts, replies and guide tips project their authors', () => {
  it.each([
    ['app/api/board/route.ts',             'user: project(p.user),'],
    ['app/api/board/[id]/replies/route.ts', 'replies: replies.map(r => ({ ...r, user: project(r.user) }))'],
    ['app/api/guide/[slug]/tips/route.ts',  'user: project(t.user),'],
  ])('%s', (file, snippet) => {
    const src = read(file)
    expect(src).toContain('await authorProjector(session,')
    expect(src).toContain(snippet)
  })
})

describe('20. moving sales show guests the sale, not the seller', () => {
  it('the API projects the seller, drops the neighborhood for guests, and skips hidden or banned sellers', () => {
    const src = read('app/api/moving-sales/route.ts')
    expect(src).toContain("user: project(s.user), neighborhood: session ? s.neighborhood : null")
    expect(src).toContain("user: { status: 'approved', hiddenFromMembers: false } },")
  })
  it('the detail page and its public metadata do the same', () => {
    const src = read('app/moving-sales/[id]/page.tsx')
    expect(src).toContain('{showSeller ? sale.user.name : firstNameOf(sale.user.name)}')
    expect(src).toContain('{avatar && showSeller ? (')
    expect(src).toContain('{session && sale.neighborhood && (')
    expect(src).not.toContain("${sale.neighborhood ? ` from ${sale.neighborhood}` : ''}")
  })
})

describe('16. club spotlight is member content that follows the member\'s settings', () => {
  const club = (u: Record<string, unknown> | null) => ({ id: 'c1', spotlightUserId: 'u1', spotlightNote: 'Hero', spotlightUpdatedAt: null, spotlightUser: u })
  const spot = { id: 'u1', name: 'Deniz Kaya', color: '#0f0', profilePhoto: '/p/u1.jpg', bio: 'Loves hiking', status: 'approved', hiddenFromMembers: false, profileVisibility: 'everyone' }
  const get = () => spotlightGET(new Request('http://x') as never, { params: Promise.resolve({ slug: 'hikers' }) })

  it('refuses a signed-in non-member', async () => {
    session.current = { id: 'me', role: 'member' }
    p.club.findUnique.mockResolvedValue(club(spot))
    p.clubMembership.findUnique.mockResolvedValue(null)
    expect((await get()).status).toBe(403)
  })
  it('shows a member the spotlight, and a connections-only member as a first name without photo or bio', async () => {
    session.current = { id: 'me', role: 'member' }
    p.clubMembership.findUnique.mockResolvedValue({ status: 'approved' })
    p.club.findUnique.mockResolvedValue(club(spot))
    expect(await (await get()).json()).toMatchObject({ name: 'Deniz Kaya', bio: 'Loves hiking' })
    privacy.restricted = new Set(['u1'])
    p.club.findUnique.mockResolvedValue(club({ ...spot, profileVisibility: 'connections' }))
    expect(await (await get()).json()).toMatchObject({ name: 'Deniz', photo: null, bio: null })
  })
  it('a banned or hidden spotlight member is not shown', async () => {
    session.current = { id: 'm', role: 'moderator' }
    p.club.findUnique.mockResolvedValue(club({ ...spot, hiddenFromMembers: true }))
    expect(await (await get()).json()).toBeNull()
  })
  it('the club page gates it on member content and applies the same projection', () => {
    const src = read('app/(member)/clubs/[slug]/page.tsx')
    expect(src).toContain('initialSpotlight={canSeeMemberContent ? spotlightUser : null}')
    expect(src).toContain("spotlightData.status === 'approved' && !spotlightData.hiddenFromMembers")
  })
})

describe('17. the dashboard leaves blocked members out of every feed', () => {
  const src = read('app/(member)/dashboard/page.tsx')
  it('loads the block pairs once and excludes them wherever the viewer used to be', () => {
    expect(src).toContain('const notMeOrBlocked = [session.id, ...blockedIds]')
    expect(src).not.toMatch(/\{ not: session\.id \}/)
    expect(src.match(/\{ notIn: notMeOrBlocked \}/g)!.length).toBeGreaterThanOrEqual(12)
  })
  it('club posts and others\' connections skip blocked members too, and private members stay out of the new-members strip', () => {
    expect(src).toContain('userId: { notIn: blockedIds },')
    expect(src).toContain('requesterId: { notIn: blockedIds },')
    expect(src).toContain("hiddenFromMembers: false, profileVisibility: { not: 'connections' }, joinedAt: { gte: weekAgo }")
  })
})
