import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'

// Scan 5, items 87 and 88: admin tags, partners, cities, neighborhoods and
// retention; host "My Clubs"; partner settings for a demoted account; and
// bounded, honest recurring-series creation.
const read = (f: string) => readFileSync(f, 'utf8')

const p = vi.hoisted(() => ({
  tagGroup:       { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn(), create: vi.fn() },
  partner:        { findUnique: vi.fn(), update: vi.fn() },
  user:           { findUnique: vi.fn(), findMany: vi.fn(async () => []), count: vi.fn() },
  city:           { findUnique: vi.fn() },
  neighborhood:   { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  club:           { findUnique: vi.fn(), findMany: vi.fn() },
  clubMembership: { findMany: vi.fn() },
  tag:            { findMany: vi.fn(async () => []) },
  event:          { count: vi.fn(), create: vi.fn(), findMany: vi.fn(async () => []) },
  $queryRaw:      vi.fn(),
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const cache   = vi.hoisted(() => ({ deleteCached: vi.fn(), getCached: vi.fn(), setCached: vi.fn() }))
const hoods   = vi.hoisted(() => ({ invalidateNeighborhoodCache: vi.fn() }))
const hosts   = vi.hoisted(() => ({ cities: [] as string[] }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/analyticsCache', () => cache)
vi.mock('@/lib/neighborhoodsDb', () => hoods)
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => {}), notifyNewEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/venueDirectory', () => ({ ensurePendingVenueBusiness: vi.fn(async () => {}) }))
vi.mock('@/lib/survey', () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()) }))
vi.mock('@/lib/safeUrl', async (orig) => ({
  ...(await orig<typeof import('@/lib/safeUrl')>()),
  normalizePaymentContact: vi.fn(() => ({ value: '' })),
}))
vi.mock('@/lib/city', () => ({
  DEFAULT_CITY_SLUG:   'istanbul',
  getCityTz:           vi.fn(async () => 'Europe/Istanbul'),
  todayInCity:         vi.fn(async () => '2026-09-14'),
  getCityConfig:       vi.fn(async () => ({ currency: 'TRY' })),
  resolveTargetCityId: vi.fn(async () => ({ cityId: 'c1' })),
}))
vi.mock('@/lib/access', async (orig) => ({
  ...(await orig<typeof import('@/lib/access')>()),
  isClubHost:    vi.fn(async () => false),
  isClubHostFor: vi.fn(async () => true),
  hostCityIds:   vi.fn(async () => hosts.cities),
}))

import { DELETE as tagGroupDELETE, PATCH as tagGroupPATCH } from '@/app/api/admin/tag-groups/[id]/route'
import { POST as tagGroupPOST } from '@/app/api/admin/tag-groups/route'
import { PATCH as adminPartnerPATCH } from '@/app/api/admin/partners/[id]/route'
import { GET as partnerGET, PATCH as partnerPATCH } from '@/app/api/partner/route'
import { POST as hoodsPOST, DELETE as hoodsDELETE } from '@/app/api/admin/cities/[id]/neighborhoods/route'
import { GET as retentionGET } from '@/app/api/admin/retention/route'
import { GET as hostClubsGET } from '@/app/api/host/clubs/route'
import { POST as eventPOST } from '@/app/api/admin/events/route'
import { clampOccurrences, seriesOutcomeMessage, MAX_SERIES_OCCURRENCES } from '@/lib/seriesCreate'

const admin  = { id: 'a1', name: 'Adm', email: 'a@x', role: 'admin', cityId: 'c1' }
const member = { id: 'm1', name: 'Mem', email: 'm@x', role: 'member', cityId: 'c1' }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const jsonReq = (body: unknown, url = 'http://x/app/api/x') =>
  ({ url, nextUrl: new URL(url), json: async () => body }) as never

beforeEach(() => {
  vi.clearAllMocks()
  session.current = admin
  hosts.cities = []
})

describe('87a. a tag group with tags is refused, not a foreign-key 500', () => {
  it('answers 409 naming the tag count and deletes nothing', async () => {
    p.tagGroup.findUnique.mockResolvedValue({ name: 'Venue', emoji: '🏠', _count: { tags: 3 } })
    const res = await tagGroupDELETE(jsonReq({}), params('g1'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/still has 3 tags/)
    expect(p.tagGroup.delete).not.toHaveBeenCalled()
  })
  it('deletes an empty group and busts the public tag cache', async () => {
    p.tagGroup.findUnique.mockResolvedValue({ name: 'Venue', emoji: '🏠', _count: { tags: 0 } })
    p.tagGroup.delete.mockResolvedValue({})
    expect((await tagGroupDELETE(jsonReq({}), params('g1'))).status).toBe(200)
    expect(cache.deleteCached).toHaveBeenCalledWith('tags:groups')
  })
  it('a tag added between the count and the delete still gets the 409', async () => {
    p.tagGroup.findUnique.mockResolvedValue({ name: 'Venue', emoji: '🏠', _count: { tags: 0 } })
    p.tagGroup.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' }))
    expect((await tagGroupDELETE(jsonReq({}), params('g1'))).status).toBe(409)
  })
  it('group create and rename bust the 2-minute /api/tags cache too', async () => {
    p.tagGroup.create.mockResolvedValue({ id: 'g2', name: 'New' })
    p.tagGroup.update.mockResolvedValue({ id: 'g2', name: 'Renamed' })
    await tagGroupPOST(jsonReq({ name: 'New' }))
    await tagGroupPATCH(jsonReq({ name: 'Renamed' }), params('g2'))
    expect(cache.deleteCached).toHaveBeenCalledTimes(2)
  })
  it('the page says to empty the group instead of promising a cascade', () => {
    const src = read('app/admin/tags/page.tsx')
    expect(src).not.toMatch(/Delete this group and all its tags\?/)
    expect(src).toMatch(/if \(group && group\.tags\.length > 0\) \{/)
  })
})

describe('87b. every field the admin partner panel shows actually saves', () => {
  beforeEach(() => {
    // A stored row: the route writes only values that differ from it (scan 6, batch 11).
    p.partner.findUnique.mockResolvedValue({
      cityId: 'c1', name: 'Café', category: 'Cafe', website: 'https://cafe.example', instagram: null,
      logo: '/app/api/files/general/old.jpg', coverImage: null, isActive: true,
    })
    p.partner.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data }))
  })
  const patch = (body: unknown) => adminPartnerPATCH(jsonReq(body), params('p1'))

  it('writes logo and cover image (they were silently dropped)', async () => {
    const res = await patch({ logo: '/app/api/files/general/logo.jpg', coverImage: 'https://cdn.example/cover.png' })
    expect(res.status).toBe(200)
    expect(p.partner.update.mock.calls[0][0].data).toEqual({
      logo: '/app/api/files/general/logo.jpg', coverImage: 'https://cdn.example/cover.png',
    })
  })
  it('accepts the "@username" the form asks for and stores the handle', async () => {
    expect((await patch({ instagram: '@smileys.ist' })).status).toBe(200)
    expect(p.partner.update.mock.calls[0][0].data).toEqual({ instagram: 'smileys.ist' })
  })
  it('refuses unsafe image schemes, nulls on NOT NULL columns and non-boolean isActive', async () => {
    expect((await patch({ logo: 'javascript:alert(1)' })).status).toBe(400)
    expect((await patch({ coverImage: 'data:image/png;base64,xx' })).status).toBe(400)
    expect((await patch({ category: null })).status).toBe(400)
    expect((await patch({ name: '   ' })).status).toBe(400)
    expect((await patch({ isActive: 'yes' })).status).toBe(400)
    expect(p.partner.update).not.toHaveBeenCalled()
  })
  it('clears optional fields with an empty string and ignores unknown keys', async () => {
    await patch({ website: '', logo: '', users: [{ id: 'x' }], cityId: 'other' })
    expect(p.partner.update.mock.calls[0][0].data).toEqual({ website: null, logo: null })
  })
})

describe('87c/87d. city hosts and city status', () => {
  const src = read('app/admin/cities/page.tsx')
  it('host add/remove handle bad bodies and network errors, and only touch state on success', () => {
    expect(src).toMatch(/if \(!res\.ok \|\| !d\?\.cityHostId\) \{ toast\.error/)
    expect(src).toMatch(/toast\.error\('Network error — host not added'\)/)
    expect(src).toMatch(/toast\.error\(d\?\.error \?\? `Could not remove host/)
    expect(src).toMatch(/toast\.error\('Network error — host not removed'\)/)
  })
  it('asks before taking a live city down or pausing one', () => {
    expect(src).toMatch(/\} else if \(city\.status === CITY_STATUS\.Live \|\| status === CITY_STATUS\.Paused\) \{[\s\S]{0,600}?confirmToast\([\s\S]{0,400}?if \(!ok\) return/)
  })
})

describe('87e. admin lists are fresh after edits and say when they are capped', () => {
  it('adding neighborhoods drops the 60s per-city cache', async () => {
    p.city.findUnique.mockResolvedValue({ id: 'c2', name: 'Izmir' })
    p.neighborhood.findMany.mockResolvedValue([])
    p.neighborhood.createMany.mockResolvedValue({ count: 1 })
    p.neighborhood.count.mockResolvedValue(1)
    const res = await hoodsPOST(jsonReq({ names: ['Alsancak'] }), params('c2'))
    expect(res.status).toBe(201)
    expect(hoods.invalidateNeighborhoodCache).toHaveBeenCalledWith('c2')
  })
  it('hiding a neighborhood drops it too', async () => {
    p.neighborhood.updateMany.mockResolvedValue({ count: 1 })
    const res = await hoodsDELETE(jsonReq({}, 'http://x/app/api/admin/cities/c2/neighborhoods?neighborhoodId=n1'), params('c2'))
    expect(res.status).toBe(200)
    expect(hoods.invalidateNeighborhoodCache).toHaveBeenCalledWith('c2')
  })
  it('retention counts are real totals, not the length of a 50-row page', async () => {
    p.user.findMany.mockResolvedValueOnce([{ id: 'u1', name: 'A', email: 'a@x.com' }])
    p.user.count.mockResolvedValue(300)
    p.$queryRaw
      .mockResolvedValueOnce([{ id: 'u2', name: 'B', email: 'b@x.com' }])
      .mockResolvedValueOnce([{ total: 120 }])
    const res = await retentionGET(jsonReq({}, 'http://x/app/api/admin/retention'))
    const body = await res.json()
    expect(body.stats).toEqual({ neverAttendedCount: 300, dormantCount: 120, listLimit: 50 })
    expect(p.user.findMany.mock.calls[0][0].take).toBe(50)
  })
  it('the retention page says "showing the first N of M"', () => {
    expect(read('app/admin/retention/page.tsx')).toMatch(/Showing the first \{shown\} of \{total\}/)
  })
})

describe('88a. My Clubs links only rows that open to the manage page', () => {
  it('flags a city host\'s city clubs as not manageable', async () => {
    session.current = member
    hosts.cities = ['c1']
    p.clubMembership.findMany.mockResolvedValue([{ club: { id: 'k1', name: 'Hikers', emoji: '🥾', slug: 'hikers', memberCount: 4 } }])
    p.club.findMany.mockResolvedValue([{ id: 'k2', name: 'Books', emoji: '📚', slug: 'books', memberCount: 9 }])
    const rows = await (await hostClubsGET()).json()
    expect(rows.map((r: { slug: string; canManage: boolean }) => [r.slug, r.canManage])).toEqual([['hikers', true], ['books', false]])
  })
  it('the list sends those to the public club page (basePath-relative)', () => {
    const src = read('app/host/clubs/page.tsx')
    expect(src).toMatch(/href=\{club\.canManage === false \? `\/clubs\/\$\{club\.slug\}` : `\/host\/clubs\/\$\{club\.slug\}`\}/)
    expect(src).not.toMatch(/href=\{`\/app\//)
  })
})

describe('88b. partner settings for a demoted account and null fields', () => {
  it('a demoted partner gets a readable 403, not "Forbidden"', async () => {
    session.current = { ...member, role: 'partner', partnerId: 'p1' }
    p.user.findUnique.mockResolvedValue({ role: 'member', partnerId: 'p1' })
    const res = await partnerGET()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/no longer linked to a partner/)
  })
  it('a null on a NOT NULL column is a 400, not a 500', async () => {
    session.current = { ...member, role: 'partner', partnerId: 'p1' }
    p.user.findUnique.mockResolvedValue({ role: 'partner', partnerId: 'p1' })
    // NOT NULL columns always hold a string, so a null is a change, not an echo.
    p.partner.findUnique.mockResolvedValue({ name: 'Café', discount: '10%', logo: null, coverImage: null })
    expect((await partnerPATCH(jsonReq({ discount: null }))).status).toBe(400)
    expect(p.partner.update).not.toHaveBeenCalled()
  })
  it('a partner row deleted mid-session is a 404, not a P2025 500', async () => {
    session.current = { ...member, role: 'partner', partnerId: 'p1' }
    p.user.findUnique.mockResolvedValue({ role: 'partner', partnerId: 'p1' })
    p.partner.findUnique.mockResolvedValue(null)
    expect((await partnerPATCH(jsonReq({ discount: '5%' }))).status).toBe(404)
    expect(p.partner.update).not.toHaveBeenCalled()
  })
  it('the form shows the server reason and never feeds null into an input', () => {
    const src = read('app/partner/settings/page.tsx')
    expect(src).toMatch(/\{loadError \?\? 'No business data found\.'\}/)
    expect(src).toMatch(/value=\{formData\.name \?\? ''\}/)
    expect(src).not.toMatch(/body: JSON\.stringify\(formData\)/)
  })
})

describe('88c. recurring series are bounded and report partial failure', () => {
  it('clamps occurrences to 2..52', () => {
    expect(clampOccurrences(500)).toBe(MAX_SERIES_OCCURRENCES)
    expect(clampOccurrences('0')).toBe(2)
    expect(clampOccurrences('abc')).toBe(2)
    expect(clampOccurrences(12)).toBe(12)
  })
  it('states created vs failed, which dates failed, and warns about duplicates', () => {
    expect(seriesOutcomeMessage(4, 4, [])).toBeNull()
    const msg = seriesOutcomeMessage(4, 3, [{ date: '2026-10-27', error: 'Invalid cover image URL' }])!
    expect(msg).toMatch(/Created 3 of 4 events; 1 failed/)
    expect(msg).toMatch(/2026-10-27: Invalid cover image URL/)
    expect(msg).toMatch(/duplicate/)
    expect(seriesOutcomeMessage(1, 0, [{ date: '2026-10-20', error: 'Missing required fields' }])).toBe('Missing required fields')
  })

  const payload = (over: Record<string, unknown> = {}) => ({
    title: 'Run club', date: '2026-10-20', time: '19:00', location: 'Moda', neighborhood: 'Kadıköy',
    clubId: 'k1', hostId: 'a1', description: 'x', totalSpots: 20, price: '0', memberPrice: '', ...over,
  })
  const post = (body: Record<string, unknown>) =>
    eventPOST(new Request('https://x/api/admin/events', { method: 'POST', body: JSON.stringify(body) }) as never)

  it('the server refuses a series occurrence past the cap with a 400', async () => {
    p.club.findUnique.mockResolvedValue({ cityId: 'c1', name: 'Run' })
    p.event.count.mockResolvedValue(MAX_SERIES_OCCURRENCES)
    const res = await post(payload({ seriesId: 'series-1', isRecurring: true }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at most 52 events/)
    expect(p.event.create).not.toHaveBeenCalled()
  })
  it('an occurrence under the cap is created', async () => {
    p.club.findUnique.mockResolvedValue({ cityId: 'c1', name: 'Run' })
    p.event.count.mockResolvedValue(MAX_SERIES_OCCURRENCES - 1)
    p.event.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'e1', ...data }))
    // The host is looked up (lib/eventHostCheck): a live member.
    p.user.findUnique.mockResolvedValue({ status: 'approved', suspendedUntil: null, cityId: 'c1' })
    expect((await post(payload({ seriesId: 'series-1', isRecurring: true }))).status).toBe(200)
  })

  it.each(['app/admin/events/new/page.tsx', 'app/host/events/new/page.tsx'])('%s attempts every date and reports the outcome', (file) => {
    const src = read(file)
    expect(src).toMatch(/const outcome = seriesOutcomeMessage\(dates\.length, created, failures\)/)
    // Every date is built from the clamped count — a loop in the host form,
    // lib/seriesDates in the admin one (which also clamps monthly days).
    expect(src).toMatch(/for \(let i = 0; i < clampOccurrences\(occurrences\); i\+\+\)|seriesDates\(form\.date, repeat, clampOccurrences\(occurrences\)\)/)
    expect(src).toMatch(/max=\{MAX_SERIES_OCCURRENCES\}/)
    // The first failure no longer aborts the loop mid-series.
    expect(src).not.toMatch(/if \(!res\.ok\) \{ setError\(data\.error \?\? 'Failed[^']*'\); return \}/)
  })
})
