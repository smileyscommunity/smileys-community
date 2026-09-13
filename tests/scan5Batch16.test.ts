import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Scan 5, batch 16 — items 62, 67, 68.
//
// 62: hangouts, availability pulses and board posts were filed into the city
//     being BROWSED (resolveCityId) instead of the member's posting city.
// 67: the community board opened with ?city= fetched plans/visitors for the
//     cookie city, named the cookie city, and hid "Posting to" on phones.
// 68: a deep-linked post prepended to page 1 broke "Load more" (16 !== 15,
//     offset off by one), and overlapping loads could land out of order.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  hangout:            { create: vi.fn(), findMany: vi.fn() },
  availabilityPulse:  { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  boardPost:          { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  club:               { findUnique: vi.fn() },
  clubMembership:     { findUnique: vi.fn() },
  event:              { findUnique: vi.fn() },
  memberConnection:   { findMany: vi.fn() },
  memberBlock:        { findMany: vi.fn() },
  user:               { findMany: vi.fn() },
  hangoutJoin:        { findMany: vi.fn() },
} }))
// The browsed city is İzmir; the member's posting city is Istanbul. Every
// write must land in Istanbul.
vi.mock('@/lib/city', () => ({
  resolveCityId: vi.fn(async () => 'city-izmir'),
  getCityTz:     vi.fn(async () => 'Europe/Istanbul'),
}))
vi.mock('@/lib/cityMembership', () => ({ resolvePostingCityId: vi.fn(async () => 'city-istanbul') }))
vi.mock('@/lib/cities', () => ({ getPublicCity: vi.fn(async () => null) }))
vi.mock('@/lib/neighborhoodsDb', () => ({
  safeNeighborhoodFor: vi.fn(async (_cityId: string, name: unknown) => (typeof name === 'string' && name ? name : null)),
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/authorProjection', () => ({ authorProjector: vi.fn(async () => (u: unknown) => u) }))

import { POST as hangoutPOST } from '@/app/api/hangouts/route'
import { POST as pulsePOST } from '@/app/api/availability/route'
import { GET as boardGET, POST as boardPOST } from '@/app/api/board/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const jsonReq = (body: unknown) => ({ json: async () => body }) as any
const getReq  = (qs: string) => ({ url: `http://x/api/board${qs}` }) as any
// The fan-outs are fire-and-forget after the 201 — let them run.
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }

beforeEach(() => {
  vi.clearAllMocks()
  m(getSession).mockResolvedValue({ id: 'u1', name: 'Ayşe', cityId: 'city-istanbul' })
  m(prisma.memberConnection.findMany).mockResolvedValue([])
  m(prisma.memberBlock.findMany).mockResolvedValue([])
  m(prisma.user.findMany).mockResolvedValue([])
  m(prisma.hangoutJoin.findMany).mockResolvedValue([])
})

describe('62 new rows file to the posting city, not the browsed one', () => {
  it('hangout: row, neighborhood validation and locals fan-out all use the posting city', async () => {
    m(prisma.hangout.create).mockImplementation(async ({ data }: any) => ({ id: 'h1', ...data }))
    const start = new Date(Date.now() + 60 * 60_000)
    const res = await hangoutPOST(jsonReq({
      title: 'Coffee', location: 'Moda pier', neighborhood: 'Moda',
      startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
    }))
    expect(res.status).toBe(201)
    expect(m(safeNeighborhoodFor)).toHaveBeenCalledWith('city-istanbul', 'Moda')
    expect(m(prisma.hangout.create).mock.calls[0][0].data.cityId).toBe('city-istanbul')
    await flush()
    expect(m(prisma.user.findMany).mock.calls[0][0].where.cityId).toBe('city-istanbul')
    expect(m(prisma.hangoutJoin.findMany).mock.calls[0][0].where.hangout.cityId).toBe('city-istanbul')
  })

  it('pulse: row, neighborhood validation and locals fan-out all use the posting city', async () => {
    m(prisma.availabilityPulse.deleteMany).mockResolvedValue({ count: 0 })
    m(prisma.availabilityPulse.create).mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }))
    const res = await pulsePOST(jsonReq({ neighborhood: 'Moda', untilMinutes: 60 }))
    expect(res.status).toBe(201)
    expect(m(safeNeighborhoodFor)).toHaveBeenCalledWith('city-istanbul', 'Moda')
    expect(m(prisma.availabilityPulse.create).mock.calls[0][0].data.cityId).toBe('city-istanbul')
    await flush()
    expect(m(prisma.user.findMany).mock.calls[0][0].where.cityId).toBe('city-istanbul')
  })

  it('plain board post: files to and validates against the posting city', async () => {
    m(prisma.boardPost.create).mockResolvedValue({ id: 'b1' })
    const res = await boardPOST(jsonReq({ type: 'question', title: 'Best dentist?', neighborhood: 'Moda' }))
    expect(res.status).toBe(201)
    expect(m(safeNeighborhoodFor)).toHaveBeenCalledWith('city-istanbul', 'Moda')
    expect(m(prisma.boardPost.create).mock.calls[0][0].data.cityId).toBe('city-istanbul')
  })

  it('club board post: stays on the club\'s city, neighborhood checked there', async () => {
    m(prisma.club.findUnique).mockResolvedValue({ id: 'c1', isActive: true, cityId: 'city-bursa' })
    m(prisma.clubMembership.findUnique).mockResolvedValue({ status: 'approved' })
    m(prisma.boardPost.create).mockResolvedValue({ id: 'b2' })
    const res = await boardPOST(jsonReq({ type: 'share', title: 'Hike Sunday', club: 'hikers', neighborhood: 'Nilüfer' }))
    expect(res.status).toBe(201)
    expect(m(safeNeighborhoodFor)).toHaveBeenCalledWith('city-bursa', 'Nilüfer')
    expect(m(prisma.boardPost.create).mock.calls[0][0].data.cityId).toBe('city-bursa')
  })

  it('global club board post (no club city): falls back to the posting city', async () => {
    m(prisma.club.findUnique).mockResolvedValue({ id: 'c2', isActive: true, cityId: null })
    m(prisma.clubMembership.findUnique).mockResolvedValue({ status: 'approved' })
    m(prisma.boardPost.create).mockResolvedValue({ id: 'b3' })
    await boardPOST(jsonReq({ type: 'share', title: 'Language swap', club: 'languages' }))
    expect(m(prisma.boardPost.create).mock.calls[0][0].data.cityId).toBe('city-istanbul')
  })
})

describe('68 GET /api/board marks the deep-linked prepend', () => {
  const post = (id: string) => ({
    id, type: 'question', title: id, body: '', neighborhood: null, tag: null, whenLabel: null,
    expiresAt: null, pinned: false, createdAt: new Date(0),
    user: { id: 'a', name: 'A', color: '#000', profilePhoto: null, profileVisibility: 'members' },
    _count: { replies: 0, interests: 0, saves: 0 },
  })
  const fullPage = Array.from({ length: 15 }, (_, i) => post(`p${i}`))

  beforeEach(() => { m(getSession).mockResolvedValue(null) })

  it('a prepended post is named, and the real page still reads as full (more to load)', async () => {
    m(prisma.boardPost.findMany).mockResolvedValue(fullPage)
    m(prisma.boardPost.findFirst).mockResolvedValue(post('deep'))
    const data = await (await boardGET(getReq('?post=deep'))).json()
    expect(data.posts).toHaveLength(16)
    expect(data.posts[0].id).toBe('deep')
    expect(data.prependedPostId).toBe('deep')
    // The client's rule: un-prepended page length >= 15 → hasMore.
    expect(data.posts.length - (data.prependedPostId ? 1 : 0)).toBeGreaterThanOrEqual(15)
  })

  it('no prepend when the deep-linked post is already on the page', async () => {
    m(prisma.boardPost.findMany).mockResolvedValue(fullPage)
    const data = await (await boardGET(getReq('?post=p3'))).json()
    expect(data.posts).toHaveLength(15)
    expect(data.prependedPostId).toBeNull()
    expect(m(prisma.boardPost.findFirst)).not.toHaveBeenCalled()
  })

  it('no prepend without ?post=', async () => {
    m(prisma.boardPost.findMany).mockResolvedValue(fullPage.slice(0, 4))
    const data = await (await boardGET(getReq(''))).json()
    expect(data.prependedPostId).toBeNull()
  })
})

// ── Client source pins ─────────────────────────────────────────────────────
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const feed      = read('components/BoardFeed.tsx')
const hangoutsApi = read('app/api/hangouts/route.ts')

describe('67 the board reads, names and posts one city', () => {
  it('GET /api/hangouts honours ?city= like GET /api/board, falling back to the viewer\'s city', () => {
    expect(hangoutsApi).toMatch(/const cityId\s+= \(citySlug \? \(await getPublicCity\(citySlug\)\)\?\.id : undefined\) \?\? await resolveCityId\(session\)/)
    expect(hangoutsApi).toMatch(/status: 'active',\s*cityId,/)
    expect(hangoutsApi).toMatch(/todayInTz\(await getCityTz\(cityId\)\)/)
  })

  it('every read BoardFeed makes carries the pinned city', () => {
    expect(feed).toMatch(/const cityQs = pinnedCity \? `\?city=\$\{encodeURIComponent\(pinnedCity\)\}` : ''/)
    expect(feed).toContain('fetch(`/app/api/hangouts${cityQs}`')
    expect(feed).toContain('fetch(`/app/api/visitors${cityQs}`')
    expect(feed).toContain('fetch(`/app/api/city/current${cityQs}`')
    expect(feed).not.toMatch(/fetch\('\/app\/api\/(hangouts|visitors)'/)
  })

  it('visitors heading and plan times come from the city on screen, not the cookie', () => {
    expect(feed).toMatch(/function VisitorsModule\(\{ visitors, cityName \}/)
    expect(feed).toMatch(/function HangoutsModule\(\{ hangouts, tz \}/)
    expect(feed).toContain("cityName={shownCity?.name ?? ''}")
    expect(feed).toContain('tz={shownCity?.timezone ?? DEFAULT_TZ}')
  })

  it('composer neighborhoods and hint follow the POSTING city; the hint shows on phones', () => {
    expect(feed).toMatch(/const postingCity = useCurrentCity\(\)\?\.posting\s*\n\s*const neighborhoods = useCityNeighborhoods\(postingCity\?\.slug\)/)
    expect(feed).toMatch(/Posting to <span className="font-semibold text-gray-700">\{postingCity\.name\}<\/span>/)
    expect(feed).not.toContain('hidden sm:inline')
  })

  it('a post filed to a different city than the one shown says where it went', () => {
    expect(feed).toMatch(/if \(!postClub && postingCity && shownCity && postingCity\.slug !== shownCity\.slug\) \{\s*toast\.success\(`Posted to \$\{postingCity\.name\}'s board/)
  })
})

describe('68 BoardFeed paging and the load sequence guard', () => {
  it('hasMore and the next offset come from the real page, not posts.length', () => {
    expect(feed).toMatch(/const pageLength = next\.length - \(prepended \? 1 : 0\)/)
    expect(feed).toMatch(/nextOffset\.current = offset \+ pageLength/)
    expect(feed).toMatch(/setHasMore\(pageLength >= 15\)/)
    expect(feed).toMatch(/const offset = append \? nextOffset\.current : 0/)
    expect(feed).not.toMatch(/next\.length === 15/)
    expect(feed).not.toMatch(/load\(filter, posts\.length, true\)/)
  })

  it('an appended page never renders the deep-linked post twice', () => {
    expect(feed).toMatch(/const seen = new Set\(prev\.map\(p => p\.id\)\)\s*\n\s*return \[\.\.\.prev, \.\.\.next\.filter\(p => !seen\.has\(p\.id\)\)\]/)
  })

  it('a slower earlier fetch cannot overwrite a newer one', () => {
    expect(feed).toMatch(/const seq = append \? loadSeq\.current : \+\+loadSeq\.current/)
    const guard = feed.indexOf('if (!isCurrent()) return')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(feed.indexOf('setPosts(prev => {'))
    expect(feed).toMatch(/finally \{\s*if \(isCurrent\(\)\) setLoading\(false\)/)
  })
})
