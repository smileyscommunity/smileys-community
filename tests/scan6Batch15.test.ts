import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 6, batch 15: the host new-event form geocoded (and listed
// neighborhoods, priced, and picked "today") in the BROWSED city, while the
// server files the event into the selected club's city. A Tbilisi club's event
// made while browsing Istanbul searched Nominatim with countrycodes=tr.
// GET /api/host/clubs now carries each club's city so the form can follow it.
const read = (f: string) => readFileSync(f, 'utf8')

const p = vi.hoisted(() => ({
  club:           { findMany: vi.fn() },
  clubMembership: { findMany: vi.fn() },
  city:           { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const hosts   = vi.hoisted(() => ({ cities: [] as string[] }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/access', async (orig) => ({
  ...(await orig<typeof import('@/lib/access')>()),
  hostCityIds: vi.fn(async () => hosts.cities),
}))

import { GET as hostClubsGET } from '@/app/api/host/clubs/route'

const tbilisi = { id: 'c-tb', slug: 'tbilisi', name: 'Tbilisi', country: 'GE', timezone: 'Asia/Tbilisi', currency: 'GEL' }
const istanbul = { id: 'c-ist', slug: 'istanbul', name: 'Istanbul', country: 'TR', timezone: 'Europe/Istanbul', currency: 'TRY' }
const member = { id: 'h1', name: 'Host', email: 'h@x', role: 'member', cityId: 'c-ist' }

beforeEach(() => {
  vi.clearAllMocks()
  session.current = member
  hosts.cities = []
})

describe('GET /api/host/clubs returns each club\'s city', () => {
  it('club-host memberships carry the club city slug and id; a global club carries null', async () => {
    p.clubMembership.findMany.mockResolvedValue([
      { club: { id: 'k1', name: 'Tbilisi Hikers', emoji: '🥾', slug: 'tb-hikers', memberCount: 4, city: tbilisi } },
      { club: { id: 'k2', name: 'English', emoji: '🇬🇧', slug: 'english', memberCount: 9, city: null } },
    ])
    const rows = await (await hostClubsGET()).json()
    expect(rows.map((r: { slug: string; city: { slug: string; id: string } | null; canManage: boolean }) => [r.slug, r.city?.slug ?? null, r.city?.id ?? null, r.canManage]))
      .toEqual([['tb-hikers', 'tbilisi', 'c-tb', true], ['english', null, null, true]])
    // Still only active clubs, still one query — the city is a relation select, not a lookup per club.
    const args = p.clubMembership.findMany.mock.calls[0][0]
    expect(args.where).toMatchObject({ userId: 'h1', role: 'host', status: 'approved', club: { isActive: true } })
    expect(args.select.club.select.city).toEqual({ select: expect.objectContaining({ id: true, slug: true }) })
    expect(p.city.findUnique).not.toHaveBeenCalled()
    expect(p.city.findFirst).not.toHaveBeenCalled()
    expect(p.city.findMany).not.toHaveBeenCalled()
  })

  it('a city host\'s city clubs carry their city too, flagged not manageable', async () => {
    hosts.cities = ['c-tb']
    p.clubMembership.findMany.mockResolvedValue([])
    p.club.findMany.mockResolvedValue([{ id: 'k3', name: 'Books', emoji: '📚', slug: 'books', memberCount: 2, city: tbilisi }])
    const rows = await (await hostClubsGET()).json()
    expect(rows).toEqual([expect.objectContaining({ slug: 'books', city: expect.objectContaining({ slug: 'tbilisi', id: 'c-tb' }), canManage: false })])
    const args = p.club.findMany.mock.calls[0][0]
    expect(args.where).toMatchObject({ cityId: { in: ['c-tb'] }, isActive: true })
    expect(args.select.city).toEqual({ select: expect.objectContaining({ id: true, slug: true }) })
  })

  it('admins get every club with its city', async () => {
    session.current = { ...member, role: 'admin' }
    p.club.findMany.mockResolvedValue([{ id: 'k4', name: 'Sailing', emoji: '⛵', slug: 'sailing', memberCount: 7, city: istanbul }])
    const rows = await (await hostClubsGET()).json()
    expect(rows).toEqual([expect.objectContaining({ slug: 'sailing', city: expect.objectContaining({ slug: 'istanbul' }), canManage: true })])
    expect(p.club.findMany.mock.calls[0][0].select.city).toEqual({ select: expect.objectContaining({ id: true, slug: true }) })
  })
})

describe('host new-event form follows the selected club\'s city', () => {
  const src = read('app/host/events/new/page.tsx')

  it('derives the event city from the selected club, falling back to the browsed city', () => {
    // Global club (city null) or no club yet → browsed city, which is what
    // the POST route's resolveTargetCityId → resolveCityId files it under.
    expect(src).toMatch(/const eventCity = clubs\.find\(c => c\.id === form\.clubId\)\?\.city \?\? city/)
  })

  it('geocodes with the event city slug, never the browsed city directly', () => {
    expect(src).toMatch(/const geocodeCityParam = eventCity\?\.slug \? `&city=\$\{encodeURIComponent\(eventCity\.slug\)\}` : ''/)
    expect(src).not.toMatch(/geocodeCityParam = city\?\.slug/)
    expect(src).toMatch(/const cityHint = eventCity \?/)
  })

  it('timezone, neighborhoods and price labels follow the same city', () => {
    expect(src).toMatch(/const tz = eventCity\?\.timezone \?\? DEFAULT_TZ/)
    expect(src).toMatch(/const neighborhoods = useCityNeighborhoods\(eventCity\?\.slug\)/)
    expect(src).not.toMatch(/useCityNeighborhoods\(\s*\)/)
    expect(src.match(/currencySymbol\(eventCity\?\.currency\)/g)).toHaveLength(2)
    expect(src).not.toMatch(/city\?\.(timezone|currency)/)
  })

  it('a neighborhood from another city\'s list is neither shown nor sent', () => {
    expect(src).toMatch(/value=\{neighborhoodIfListed\(form\.neighborhood, neighborhoods\)\}/)
    expect(src).toMatch(/neighborhood: neighborhoodIfListed\(form\.neighborhood, neighborhoods\),/)
  })
})
