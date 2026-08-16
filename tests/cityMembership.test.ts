import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  user:             { findUnique: vi.fn(), update: vi.fn() },
  city:             { findUnique: vi.fn() },
  cityRelationship: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  $transaction:     vi.fn(),
} }))

import { prisma } from '@/lib/prisma'
import { getMemberCities, joinCity, leaveCity, setHomeCity } from '@/lib/cityMembership'

const ISTANBUL = { id: 'c-ist', slug: 'istanbul', name: 'Istanbul', status: 'live' }
const ATHENS   = { id: 'c-ath', slug: 'athens',   name: 'Athens',   status: 'live' }
const IZMIR    = { id: 'c-izm', slug: 'izmir',    name: 'Izmir',    status: 'preparing' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.cityRelationship.findUnique as any).mockResolvedValue(null)
  ;(prisma.cityRelationship.create as any).mockResolvedValue({ id: 'r1' })
  ;(prisma.cityRelationship.update as any).mockResolvedValue({ id: 'r1' })
  ;(prisma.cityRelationship.deleteMany as any).mockResolvedValue({ count: 1 })
})

describe('getMemberCities', () => {
  it('always includes the home city, even with no relationship rows', async () => {
    // The case that must not need a backfill: an existing member who has never
    // joined a second city still belongs to their own.
    ;(prisma.user.findUnique as any).mockResolvedValue({ city: ISTANBUL, cityRelationships: [] })
    const cities = await getMemberCities('u1')
    expect(cities).toEqual([{ ...ISTANBUL, home: true }])
  })

  it('lists home first, then joined cities', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      city: ISTANBUL, cityRelationships: [{ city: ATHENS }],
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
    expect(prisma.cityRelationship.create).toHaveBeenCalledWith({
      data: { userId: 'u1', cityId: ATHENS.id, type: 'member' },
    })
  })

  it('is idempotent — a second join is a success, not an error or a duplicate', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    ;(prisma.cityRelationship.findUnique as any).mockResolvedValue({ id: 'existing', type: 'member' })
    const r = await joinCity('u1', 'athens')
    expect(r).toMatchObject({ ok: true, alreadyMember: true })
    expect(prisma.cityRelationship.create).not.toHaveBeenCalled()
    expect(prisma.cityRelationship.update).not.toHaveBeenCalled()
  })

  it('transitions a pre-launch interest row into membership on join', async () => {
    // The launch-day promise: "we'll let you know" ends in a join, and the
    // waiting-list row becomes the membership rather than duplicating it.
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    ;(prisma.cityRelationship.findUnique as any).mockResolvedValue({ id: 'interest-row', type: 'interested' })
    const r = await joinCity('u1', 'athens')
    expect(r).toMatchObject({ ok: true, alreadyMember: false })
    expect(prisma.cityRelationship.update).toHaveBeenCalledWith({
      where: { id: 'interest-row' }, data: { type: 'member' },
    })
    expect(prisma.cityRelationship.create).not.toHaveBeenCalled()
  })

  it('treats joining your own home city as already-a-member, not an error', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ISTANBUL)
    const r = await joinCity('u1', 'istanbul')
    expect(r).toMatchObject({ ok: true, alreadyMember: true })
    // Crucially it must not write a row — home lives on the user, never here.
    expect(prisma.cityRelationship.create).not.toHaveBeenCalled()
  })

  it('refuses a city that is not live — no joining an empty room', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(IZMIR)
    const r = await joinCity('u1', 'izmir')
    expect(r.ok).toBe(false)
    expect(prisma.cityRelationship.create).not.toHaveBeenCalled()
  })

  it('refuses a member who is not approved yet', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'pending' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    const r = await joinCity('u1', 'athens')
    expect(r.ok).toBe(false)
    expect(prisma.cityRelationship.create).not.toHaveBeenCalled()
  })
})

describe('setHomeCity', () => {
  it('moves home and keeps the old city as a joined city, in one transaction', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    const r = await setHomeCity('u1', 'athens')
    expect(r).toMatchObject({ ok: true, alreadyHome: false })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    // The three legs: keep old home as membership (upsert absorbs a stale
    // interest row), drop any row for the new home (home must never also be
    // a relationship row), set the new home.
    expect(prisma.cityRelationship.upsert).toHaveBeenCalledWith({
      where:  { userId_cityId: { userId: 'u1', cityId: ISTANBUL.id } },
      create: { userId: 'u1', cityId: ISTANBUL.id, type: 'member' },
      update: { type: 'member' },
    })
    expect(prisma.cityRelationship.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', cityId: ATHENS.id },
    })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' }, data: { cityId: ATHENS.id },
    })
  })

  it('is a no-op success when the target is already home', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ISTANBUL)
    const r = await setHomeCity('u1', 'istanbul')
    expect(r).toMatchObject({ ok: true, alreadyHome: true })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('refuses a non-live city — home must never point at an empty room', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'approved' })
    ;(prisma.city.findUnique as any).mockResolvedValue(IZMIR)
    const r = await setHomeCity('u1', 'izmir')
    expect(r.ok).toBe(false)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('refuses an unapproved member', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id, status: 'pending' })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    const r = await setHomeCity('u1', 'athens')
    expect(r.ok).toBe(false)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('leaveCity', () => {
  it('leaves a joined city — scoped to member rows only', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id })
    ;(prisma.city.findUnique as any).mockResolvedValue(ATHENS)
    expect(await leaveCity('u1', 'athens')).toEqual({ ok: true })
    expect(prisma.cityRelationship.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', cityId: ATHENS.id, type: 'member' },
    })
  })

  it('refuses to leave the home city — that is a move, not a leave', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ cityId: ISTANBUL.id })
    ;(prisma.city.findUnique as any).mockResolvedValue(ISTANBUL)
    const r = await leaveCity('u1', 'istanbul')
    expect(r.ok).toBe(false)
    expect(prisma.cityRelationship.deleteMany).not.toHaveBeenCalled()
  })
})
