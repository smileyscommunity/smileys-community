import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  user:           { findUnique: vi.fn() },
  city:           { findUnique: vi.fn() },
  cityMembership: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { getMemberCities, joinCity, leaveCity } from '@/lib/cityMembership'

const ISTANBUL = { id: 'c-ist', slug: 'istanbul', name: 'Istanbul', status: 'live' }
const ATHENS   = { id: 'c-ath', slug: 'athens',   name: 'Athens',   status: 'live' }
const IZMIR    = { id: 'c-izm', slug: 'izmir',    name: 'Izmir',    status: 'preparing' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.cityMembership.findUnique as any).mockResolvedValue(null)
  ;(prisma.cityMembership.create as any).mockResolvedValue({ id: 'm1' })
  ;(prisma.cityMembership.deleteMany as any).mockResolvedValue({ count: 1 })
})

describe('getMemberCities', () => {
  it('always includes the home city, even with no membership rows', async () => {
    // The case that must not need a backfill: an existing member who has never
    // joined a second city still belongs to their own.
    ;(prisma.user.findUnique as any).mockResolvedValue({ city: ISTANBUL, cityMemberships: [] })
    const cities = await getMemberCities('u1')
    expect(cities).toEqual([{ ...ISTANBUL, home: true }])
  })

  it('lists home first, then joined cities', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      city: ISTANBUL, cityMemberships: [{ city: ATHENS }],
    })
    const cities = await getMemberCities('u1')
    expect(cities.map(c => [c.slug, c.home])).toEqual([['istanbul', true], ['athens', false]])
  })
})

describe('joinCity', () => {
  it('joins a live city', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    const r = await joinCity('u1', 'athens')
    expect(r).toMatchObject({ ok: true, alreadyMember: false })
    expect(prisma.cityMembership.create).toHaveBeenCalled()
  })

  it('is idempotent — a second join is a success, not an error or a duplicate', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    ;(prisma.cityMembership.findUnique as any).mockResolvedValue({ id: 'existing' })
    const r = await joinCity('u1', 'athens')
    expect(r).toMatchObject({ ok: true, alreadyMember: true })
    expect(prisma.cityMembership.create).not.toHaveBeenCalled()
  })

  it('treats joining your own home city as already-a-member, not an error', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ISTANBUL)
    const r = await joinCity('u1', 'istanbul')
    expect(r).toMatchObject({ ok: true, alreadyMember: true })
    // Crucially it must not write a row — home lives on the user, never here.
    expect(prisma.cityMembership.create).not.toHaveBeenCalled()
  })

  it('refuses a city that is not live — no joining an empty room', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(IZMIR)
    const r = await joinCity('u1', 'izmir')
    expect(r.ok).toBe(false)
    expect(prisma.cityMembership.create).not.toHaveBeenCalled()
  })

  it('refuses a member who is not approved yet', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'pending' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    const r = await joinCity('u1', 'athens')
    expect(r.ok).toBe(false)
    expect(prisma.cityMembership.create).not.toHaveBeenCalled()
  })
})

describe('leaveCity', () => {
  it('leaves a joined city', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    expect(await leaveCity('u1', 'athens')).toEqual({ ok: true })
    expect(prisma.cityMembership.deleteMany).toHaveBeenCalled()
  })

  it('refuses to leave the home city — that is a move, not a leave', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id })
    ;(prisma.city.findUnique as any).mockResolvedValue(ISTANBUL)
    const r = await leaveCity('u1', 'istanbul')
    expect(r.ok).toBe(false)
    expect(prisma.cityMembership.deleteMany).not.toHaveBeenCalled()
  })
})
