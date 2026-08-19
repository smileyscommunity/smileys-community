import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  city:         { findUnique: vi.fn(), update: vi.fn() },
  club:         { count: vi.fn() },
  cityHost:     { count: vi.fn() },
  neighborhood: { count: vi.fn() },
} }))
vi.mock('@/lib/audit',       () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/cityLaunch',  () => ({ notifyCityLaunch: vi.fn(async () => ({ notified: 0, failed: 0 })) }))
vi.mock('@/lib/seedCityClubs', () => ({ seedCityClubs: vi.fn(async () => ({ created: 11, skipped: 0 })) }))

import { PATCH } from '@/app/api/admin/cities/[id]/route'
import { POST as LAUNCH_CLUBS } from '@/app/api/admin/cities/[id]/launch-clubs/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { seedCityClubs } from '@/lib/seedCityClubs'

// Two gates that between them decide whether a city can look abandoned in
// public. Both were incomplete:
//
// 1. The go-live gate counted clubs and hosts. The launch checklist calls
//    neighborhoods "this one is a launch blocker" — the only item it marks
//    that way — and the code never counted them, so the doc and the gate
//    disagreed about what blocks a launch. A city with no neighborhood rows
//    renders an empty dropdown in every picker and safeNeighborhoodFor nulls
//    whatever is submitted, so the field looks saved and comes back blank.
//
// 2. Club seeding had no status gate at all. That is how Izmir ended up
//    `coming_soon` with 11 clubs and 0 members.

const params = { params: Promise.resolve({ id: 'c1' }) }
const req = (body: any = {}) => ({ json: async () => body }) as any
const ADMIN = { id: 'a1', role: 'admin', name: 'Admin', cityId: 'c1' }

// Ready on every axis; each test knocks out the one it is about.
function counts({ clubs = 5, hosts = 2, neighborhoods = 9 } = {}) {
  ;(prisma.club.count as any).mockResolvedValue(clubs)
  ;(prisma.cityHost.count as any).mockResolvedValue(hosts)
  ;(prisma.neighborhood.count as any).mockResolvedValue(neighborhoods)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(ADMIN)
  ;(prisma.city.findUnique as any).mockResolvedValue({
    id: 'c1', name: 'Izmir', slug: 'izmir', status: 'preparing',
  })
  ;(prisma.city.update as any).mockResolvedValue({ id: 'c1', name: 'Izmir', slug: 'izmir', status: 'live' })
  counts()
})

describe('go-live gate', () => {
  it('refuses live when the city has no neighborhoods — the blocker the doc names and the code missed', async () => {
    counts({ neighborhoods: 0 })
    const res = await PATCH(req({ status: 'live' }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('0 neighborhoods')
    expect(prisma.city.update).not.toHaveBeenCalled()
  })

  it('still refuses on the two it already caught', async () => {
    counts({ clubs: 0 })
    expect((await PATCH(req({ status: 'live' }), params)).status).toBe(400)
    counts({ hosts: 0 })
    expect((await PATCH(req({ status: 'live' }), params)).status).toBe(400)
  })

  it('names all three counts, so the admin knows what is actually missing', async () => {
    counts({ clubs: 0, hosts: 0, neighborhoods: 0 })
    const body = await (await PATCH(req({ status: 'live' }), params)).json()
    expect(body.error).toContain('0 active clubs')
    expect(body.error).toContain('0 hosts')
    expect(body.error).toContain('0 neighborhoods')
  })

  it('singularises correctly rather than saying "1 neighborhoods"', async () => {
    counts({ clubs: 1, hosts: 1, neighborhoods: 0 })
    const body = await (await PATCH(req({ status: 'live' }), params)).json()
    expect(body.error).toContain('1 active club,')
    expect(body.error).toContain('1 host')
    expect(body.error).not.toContain('1 active clubs')
  })

  it('lets a ready city go live', async () => {
    const res = await PATCH(req({ status: 'live' }), params)
    expect(res.status).toBe(200)
    expect(prisma.city.update).toHaveBeenCalled()
  })

  it('does not re-gate a city that is already live', async () => {
    ;(prisma.city.findUnique as any).mockResolvedValue({ id: 'c1', name: 'Izmir', slug: 'izmir', status: 'live' })
    counts({ clubs: 0, hosts: 0, neighborhoods: 0 })
    const res = await PATCH(req({ status: 'live' }), params)
    expect(res.status).toBe(200)
  })

  it('never gates a move to a non-live status', async () => {
    counts({ clubs: 0, hosts: 0, neighborhoods: 0 })
    expect((await PATCH(req({ status: 'preparing' }), params)).status).toBe(200)
    expect((await PATCH(req({ status: 'paused' }), params)).status).toBe(200)
  })
})

describe('club seeding gate', () => {
  it('refuses to seed a coming_soon city — the shape that produced Izmir', async () => {
    ;(prisma.city.findUnique as any).mockResolvedValue({ slug: 'ankara', name: 'Ankara', status: 'coming_soon' })
    const res = await LAUNCH_CLUBS(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Preparing')
    expect(seedCityClubs).not.toHaveBeenCalled()
  })

  it('seeds a preparing city — the state that exists for exactly this', async () => {
    ;(prisma.city.findUnique as any).mockResolvedValue({ slug: 'izmir', name: 'Izmir', status: 'preparing' })
    const res = await LAUNCH_CLUBS(req(), params)
    expect(res.status).toBe(200)
    expect(seedCityClubs).toHaveBeenCalled()
  })

  it('still seeds a live city, so a template added later can be back-filled', async () => {
    ;(prisma.city.findUnique as any).mockResolvedValue({ slug: 'istanbul', name: 'Istanbul', status: 'live' })
    expect((await LAUNCH_CLUBS(req(), params)).status).toBe(200)
  })
})
