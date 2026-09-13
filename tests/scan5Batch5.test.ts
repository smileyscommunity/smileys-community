import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scan 5, items 21–22: club reviews and the cup leaderboard.

const p = vi.hoisted(() => ({
  club:           { findUnique: vi.fn() },
  clubMembership: { findUnique: vi.fn() },
  review:         { findMany: vi.fn() },
  eventAttendee:  { findMany: vi.fn() },
  cupPrediction:  { groupBy: vi.fn(), aggregate: vi.fn(async () => ({ _max: { updatedAt: null } })) },
  cupBracketPick: { findMany: vi.fn(), aggregate: vi.fn(async () => ({ _max: { updatedAt: null } })) },
  cupFixture:     { aggregate: vi.fn(async () => ({ _max: { updatedAt: null } })) },
  user:           { count: vi.fn(async () => 10), findMany: vi.fn() },
}))
const privacy = vi.hoisted(() => ({ restricted: new Set<string>() }))
const session = vi.hoisted(() => ({ current: { id: 'me', role: 'member' } as { id: string; role: string } | null }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/memberPrivacy', () => ({ restrictedSetFor: vi.fn(async () => privacy.restricted) }))

import { GET as clubReviewsGET } from '@/app/api/clubs/[slug]/reviews/route'
import { GET as leaderboardGET } from '@/app/api/cup/leaderboard/route'

beforeEach(() => {
  vi.clearAllMocks()
  privacy.restricted = new Set()
  session.current = { id: 'me', role: 'member' }
})

describe('21. club reviews', () => {
  const user = (id: string, name: string, over: Record<string, unknown> = {}) =>
    ({ id, name, color: '#f00', profilePhoto: `/p/${id}.jpg`, profileVisibility: 'everyone', hiddenFromMembers: false, ...over })
  const review = (id: string, u: ReturnType<typeof user>, eventId = 'e1') =>
    ({ id, rating: 5, text: 'Great', createdAt: new Date(), user: u, event: { id: eventId, title: 'Hike' } })
  const get = () => clubReviewsGET(new Request('http://x') as never, { params: Promise.resolve({ slug: 'hikers' }) })

  beforeEach(() => {
    p.club.findUnique.mockResolvedValue({ id: 'c1' })
    p.clubMembership.findUnique.mockResolvedValue({ status: 'approved' })
    p.eventAttendee.findMany.mockResolvedValue([])
  })

  it('refuses a signed-in member who is not in the club', async () => {
    p.clubMembership.findUnique.mockResolvedValue({ status: 'pending' })
    expect((await get()).status).toBe(403)
    expect(p.review.findMany).not.toHaveBeenCalled()
  })
  it('shows a stealth RSVP or a hidden account as an anonymous attendee, but never hides your own', async () => {
    p.review.findMany.mockResolvedValue([
      review('r1', user('ghost', 'Gizli Kişi')),
      review('r2', user('hid', 'Saklı Biri', { hiddenFromMembers: true })),
      review('r3', user('me', 'Me Myself')),
      review('r4', user('pub', 'Açık Kişi')),
    ])
    p.eventAttendee.findMany.mockResolvedValue([{ userId: 'ghost', eventId: 'e1' }, { userId: 'me', eventId: 'e1' }])
    const { reviews } = await (await get()).json()
    expect(reviews[0].user).toEqual({ id: 'member', name: 'A member who went', color: '#9ca3af', profilePhoto: null })
    expect(reviews[1].user.name).toBe('A member who went')
    expect(reviews[2].user.name).toBe('Me Myself')
    expect(reviews[3].user).toEqual({ id: 'pub', name: 'Açık Kişi', color: '#f00', profilePhoto: '/p/pub.jpg' })
    expect(JSON.stringify(reviews)).not.toMatch(/Gizli|Saklı|hiddenFromMembers|profileVisibility/)
    expect(p.review.findMany.mock.calls[0][0].where).toEqual({ event: { clubId: 'c1' }, user: { status: 'approved' } })
  })
  it('a connections-only reviewer is a first name without photo to members they are not connected to', async () => {
    privacy.restricted = new Set(['priv'])
    p.review.findMany.mockResolvedValue([review('r1', user('priv', 'Deniz Kaya', { profileVisibility: 'connections' }))])
    const { reviews } = await (await get()).json()
    expect(reviews[0].user).toEqual({ id: 'priv', name: 'Deniz', color: '#f00', profilePhoto: null })
  })
})

describe('22. cup leaderboard', () => {
  const get = () => leaderboardGET(new Request('http://x/api/cup/leaderboard?take=50'))
  const people: Record<string, { name: string; status: string; hiddenFromMembers: boolean; profileVisibility: string }> = {
    a:   { name: 'Ali Veli',     status: 'approved', hiddenFromMembers: false, profileVisibility: 'everyone' },
    ban: { name: 'Banned User',  status: 'banned',   hiddenFromMembers: false, profileVisibility: 'everyone' },
    hid: { name: 'Hidden User',  status: 'approved', hiddenFromMembers: true,  profileVisibility: 'everyone' },
    me:  { name: 'Me Myself',    status: 'approved', hiddenFromMembers: true,  profileVisibility: 'everyone' },
    prv: { name: 'Deniz Kaya',   status: 'approved', hiddenFromMembers: false, profileVisibility: 'connections' },
  }
  beforeEach(() => {
    p.cupPrediction.groupBy.mockResolvedValue(Object.keys(people).map((userId, i) => ({ userId, _sum: { pointsAwarded: 50 - i } })))
    p.cupBracketPick.findMany.mockResolvedValue([])
    p.user.findMany.mockImplementation(async ({ where, select }: { where: { id: { in: string[] } }; select: Record<string, boolean> }) =>
      where.id.in.map(id => select.status
        ? { id, status: people[id].status, hiddenFromMembers: people[id].hiddenFromMembers }
        : { id, name: people[id].name, color: '#0f0', profilePhoto: `/p/${id}.jpg`, profileVisibility: people[id].profileVisibility }))
  })

  it('refuses logged-out requests', async () => {
    session.current = null
    expect((await get()).status).toBe(401)
  })
  it('leaves banned and hidden players off the board and out of the ranks, but keeps your own row', async () => {
    const body = await (await get()).json()
    const names = body.rows.map((r: { name: string }) => r.name)
    expect(names).toEqual(['Ali V.', 'Me M.', 'Deniz K.'])
    expect(body.total).toBe(3)
    expect(body.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3])
    expect(body.yourRank).toBe(2)
  })
  it('a connections-only player is a first name without photo to members they are not connected to', async () => {
    privacy.restricted = new Set(['prv'])
    const body = await (await get()).json()
    const row = body.rows.find((r: { name: string }) => r.name.startsWith('Deniz'))
    expect(row).toMatchObject({ name: 'Deniz', profilePhoto: null })
  })
})
