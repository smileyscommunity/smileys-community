import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

// Scan 6, batch 12: the directory map's neighborhood fallback read the city
// from DirectoryClient's viewCity, which comes from a separate
// /api/city/current fetch, and the pin redraw key ignored it. So a list that
// landed before that answer (or with the previous city's answer still in
// place, or none at all when the fetch failed) drew coordinate-less
// businesses for the wrong city — and nothing redrew them. Fix: the directory
// API returns each business's own city slug, the client passes that through,
// and pinKey includes it.

const h = vi.hoisted(() => ({
  prisma: {
    business:       { count: vi.fn(), findMany: vi.fn() },
    businessReview: { groupBy: vi.fn() },
    businessSave:   { groupBy: vi.fn(), findMany: vi.fn() },
    businessClaim:  { findMany: vi.fn() },
    user:           { findMany: vi.fn() },
  },
  getSession: vi.fn(),
}))

vi.mock('@/lib/prisma',          () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',         () => ({ getSession: h.getSession }))
vi.mock('@/lib/city',            () => ({ resolveCityId: vi.fn(async () => 'c-ist') }))
vi.mock('@/lib/cities',          () => ({ getPublicCity: vi.fn(async (slug: string) => (slug === 'ankara' ? { id: 'c-ank' } : null)) }))
vi.mock('@/lib/access',          () => ({ isAdminOrModerator: () => false }))
vi.mock('@/lib/notify',          () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/email',           () => ({ sendAdminNewDirectorySubmissionEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}) }))
vi.mock('@/lib/rateLimit',       () => ({ rateLimit: vi.fn(async () => true), getIp: () => '1.2.3.4' }))
vi.mock('@/lib/neighborhoodsDb', () => ({ isValidNeighborhoodFor: vi.fn(async () => true) }))

import { GET } from '@/app/api/directory/route'
import { resolvePosition, DEFAULT_CITY_SLUG } from '@/lib/directoryMapPosition'
import { NEIGHBORHOOD_META } from '@/lib/neighborhoods'

const read = (p: string) => readFileSync(p, 'utf-8')

const row = (id: string, citySlug: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Biz ${id}`, category: 'Cafe', description: 'd',
  neighborhood: 'Bahçelievler', address: null, phone: '+90 555', website: null, instagram: null,
  logo: null, coverImage: null, isExpatOwned: false, isExpatFriendly: true, languages: null,
  latitude: null, longitude: null, hours: null, memberDiscount: null, tags: [],
  claimedById: 'u-owner',
  submittedBy: { name: 'Sarah Kowalski' },
  city: { slug: citySlug },
  createdAt: new Date('2026-09-01T00:00:00Z'),
  ...extra,
})

const get = (qs = '') => GET(new Request(`https://x/app/api/directory${qs}`) as never)

beforeEach(() => {
  vi.clearAllMocks()
  h.getSession.mockResolvedValue(null)
  h.prisma.business.count.mockResolvedValue(2)
  h.prisma.businessReview.groupBy.mockResolvedValue([])
  h.prisma.businessSave.groupBy.mockResolvedValue([])
  h.prisma.businessSave.findMany.mockResolvedValue([{ businessId: 'b1' }])
  h.prisma.businessClaim.findMany.mockResolvedValue([{ businessId: 'b1', status: 'pending' }])
})

describe('GET /api/directory returns each business\'s own city slug', () => {
  it('selects the slug through the city relation in the one page query', async () => {
    h.prisma.business.findMany.mockResolvedValue([row('b1', 'ankara'), row('b2', 'ankara')])
    const res = await get('?city=ankara')
    expect(res.status).toBe(200)
    expect(h.prisma.business.findMany).toHaveBeenCalledTimes(1)
    const args = h.prisma.business.findMany.mock.calls[0][0]
    expect(args.select.city).toEqual({ select: { slug: true } })
    expect(args.where.cityId).toBe('c-ank')
    const body = await res.json()
    expect(body.map((b: any) => b.citySlug)).toEqual(['ankara', 'ankara'])
  })

  it('ships the slug, not the city relation object', async () => {
    h.prisma.business.findMany.mockResolvedValue([row('b1', 'istanbul')])
    const [b] = await (await get()).json()
    expect(b.citySlug).toBe('istanbul')
    expect(b).not.toHaveProperty('city')
  })

  it('a guest still gets the redacted row', async () => {
    h.prisma.business.findMany.mockResolvedValue([row('b1', 'istanbul')])
    const [b] = await (await get()).json()
    expect(b).not.toHaveProperty('claimedById')
    expect(b).not.toHaveProperty('submittedBy')
    expect(JSON.stringify(b)).not.toContain('u-owner')
    expect(JSON.stringify(b)).not.toContain('Kowalski')
    // A guest learns a member added it, not who.
    expect(b).toMatchObject({ isSaved: false, isMine: false, myClaimStatus: 'none', hasClaimedOwner: true, addedBy: 'a Smileys member' })
    // no per-viewer lookups run without a session
    expect(h.prisma.businessSave.findMany).not.toHaveBeenCalled()
    expect(h.prisma.businessClaim.findMany).not.toHaveBeenCalled()
  })

  it('a member still gets their own flags alongside the slug', async () => {
    h.getSession.mockResolvedValue({ id: 'u-owner', name: 'O', role: 'member' })
    h.prisma.business.findMany.mockResolvedValue([row('b1', 'istanbul')])
    const [b] = await (await get()).json()
    expect(b).toMatchObject({ citySlug: 'istanbul', isSaved: true, isMine: true, myClaimStatus: 'pending' })
  })
})

describe('map pin placement (lib/directoryMapPosition)', () => {
  const base = { id: 'b1', latitude: null, longitude: null }

  it('own coordinates win for any city', () => {
    expect(resolvePosition({ ...base, latitude: 39.9, longitude: 32.8, neighborhood: 'Ulus', citySlug: 'ankara' })).toEqual([39.9, 32.8])
  })

  it('a default-city business without coords gets its neighborhood pin', () => {
    const meta = NEIGHBORHOOD_META['Bahçelievler']
    const pos = resolvePosition({ ...base, neighborhood: 'Bahçelievler', citySlug: DEFAULT_CITY_SLUG })
    expect(pos).not.toBeNull()
    expect(Math.abs(pos![0] - meta.lat)).toBeLessThan(0.004)
    expect(Math.abs(pos![1] - meta.lon)).toBeLessThan(0.004)
    // deterministic jitter
    expect(resolvePosition({ ...base, neighborhood: 'Bahçelievler', citySlug: DEFAULT_CITY_SLUG })).toEqual(pos)
  })

  it('another city\'s same-named neighborhood gets no pin', () => {
    expect(NEIGHBORHOOD_META['Bahçelievler']).toBeTruthy()
    expect(resolvePosition({ ...base, neighborhood: 'Bahçelievler', citySlug: 'ankara' })).toBeNull()
    expect(resolvePosition({ ...base, neighborhood: 'Ulus', citySlug: 'ankara' })).toBeNull()
  })

  it('an unknown city gets no pin', () => {
    expect(resolvePosition({ ...base, neighborhood: 'Bahçelievler', citySlug: null })).toBeNull()
    expect(resolvePosition({ ...base, neighborhood: 'Bahçelievler' })).toBeNull()
  })
})

describe('the map reads the row\'s city, and redraws when it changes', () => {
  const client = read('app/directory/DirectoryClient.tsx')
  const map    = read('components/DirectoryMap.tsx')

  it('DirectoryClient passes b.citySlug, not the separately fetched viewCity', () => {
    const mapJsx = client.slice(client.indexOf('<DirectoryMap'), client.indexOf('/>', client.indexOf('<DirectoryMap')))
    expect(mapJsx).toMatch(/citySlug: b\.citySlug,/)
    expect(mapJsx).not.toMatch(/citySlug: viewCity/)
    expect(client).toMatch(/\n\s+citySlug: string \| null\n/)
  })

  it('pinKey includes citySlug', () => {
    const key = map.match(/const pinKey = [^\n]+/)?.[0] ?? ''
    expect(key).toContain('${b.citySlug ?? \'\'}')
  })

  it('the map uses the shared helper rather than a private copy', () => {
    expect(map).toMatch(/import \{ resolvePosition, type PositionedBusiness \} from '@\/lib\/directoryMapPosition'/)
    expect(map).not.toMatch(/function resolvePosition\(|NEIGHBORHOOD_META/)
  })
})
