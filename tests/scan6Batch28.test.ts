import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

// An event stays in the city it was filed in. PUT /api/admin/events/[id] used to
// accept a move under another city's club and keep the old cityId — an event
// belonging to a club in one city but listed, timed and priced in another.
// Product decision (2026-09-16): refuse the move, for staff and hosts alike.
// Same-city and global (cityId null) clubs stay allowed; both edit pages offer
// only those clubs.

const h = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    club:         { findUnique: vi.fn() },
    event:        { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  }
  return {
    prisma,
    getSession:    vi.fn(),
    isClubHost:    vi.fn(),
    isClubHostFor: vi.fn(),
    hostCityIds:   vi.fn(),
    writeAudit:    vi.fn(),
  }
})

vi.mock('@/lib/prisma',  () => ({ prisma: h.prisma }))
vi.mock('@/lib/session', () => ({ getSession: h.getSession }))
vi.mock('@/lib/access', () => ({
  isAdmin:            (s: any) => s?.role === 'admin',
  isAdminOrModerator: (s: any) => s?.role === 'admin' || s?.role === 'moderator',
  isClubHost:         h.isClubHost,
  isClubHostFor:      h.isClubHostFor,
  hostCityIds:        h.hostCityIds,
}))
vi.mock('@/lib/notify',              () => ({ createNotification: vi.fn(async () => true), notifyNewEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/audit',               () => ({ writeAudit: h.writeAudit, getDiff: vi.fn(() => null) }))
vi.mock('@/lib/email',               () => ({ sendEventCancelledEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/spotsLeft',           () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/rsvpConfirmed',       () => ({ backfillSeatPayments: vi.fn(async () => {}), collectsSeatPayment: vi.fn(() => false) }))
vi.mock('@/lib/eventPublishHistory', () => ({ wasStaffPublished: vi.fn(async () => true) }))
vi.mock('@/lib/noShow',              () => ({ waiveCard: vi.fn() }))
vi.mock('@/lib/seriesOwnership',     () => ({ checkSeriesId: vi.fn(async () => ({ ok: true })), seriesScopeFor: vi.fn(() => ({})) }))
vi.mock('@/lib/eventCapacity', () => ({
  lockEventRow: vi.fn(), seatState: vi.fn(), shrinkVerdict: vi.fn(() => ({ ok: true })),
  belowApprovedBody: vi.fn(), wantsOverCapacity: vi.fn(() => false),
}))
vi.mock('@/lib/city',      () => ({ todayInCity: vi.fn(async () => '2026-09-16'), getCityTz: vi.fn(async () => 'Europe/Istanbul') }))
vi.mock('@/lib/rateLimit', () => ({ claimOnce: vi.fn(async () => true), releaseClaim: vi.fn() }))

import { PUT } from '@/app/api/admin/events/[id]/route'

const p = h.prisma as any
const read = (f: string) => readFileSync(f, 'utf-8')
const params = { params: Promise.resolve({ id: 'e1' }) } as never
const req = (body: unknown) => ({ json: async () => body }) as never

const admin = { id: 'a1', name: 'Admin', role: 'admin',  cityId: 'c-ist' }
const host  = { id: 'h1', name: 'Host',  role: 'member', cityId: 'c-ist' }

const CLUBS: Record<string, { cityId: string | null }> = {
  'club-ist':    { cityId: 'c-ist' },
  'club-ist-2':  { cityId: 'c-ist' },
  'club-tbs':    { cityId: 'c-tbs' },
  'club-global': { cityId: null },
}

const existing = (o: Record<string, unknown> = {}) => ({
  hostId: 'h1', clubId: 'club-ist', cityId: 'c-ist', date: '2026-09-30', time: '19:00', endTime: null,
  location: 'x', title: 'Picnic', neighborhood: 'x', price: 0, memberPrice: null, payTo: 'venue',
  totalSpots: 10, emoji: '🧺', isPremium: false, membersOnly: false, limitedSpots: false,
  isFirstTimerFriendly: false, status: 'published', seriesId: null, cancelledAt: null, approvalRequired: false,
  tierOverride: null,
  ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.getSession.mockResolvedValue(admin)
  h.isClubHost.mockResolvedValue(false)
  h.isClubHostFor.mockResolvedValue(true)
  h.hostCityIds.mockResolvedValue([])
  p.$transaction.mockImplementation(async (arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(p))
  p.event.findUnique.mockResolvedValue(existing())
  p.event.update.mockImplementation(async ({ data }: any) => ({ id: 'e1', ...existing(), ...data }))
  p.club.findUnique.mockImplementation(async ({ where }: any) => CLUBS[where.id] ?? null)
})

describe('moving an event to another club', () => {
  it('staff moving it under another city\'s club gets 409 and nothing is written', async () => {
    const res = await PUT(req({ clubId: 'club-tbs' }), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('club_other_city')
    expect(body.error).toMatch(/another city/)
    expect(p.event.update).not.toHaveBeenCalled()
  })

  it('a club host moving their event under another city\'s club they also host is refused too', async () => {
    h.getSession.mockResolvedValue(host)
    h.isClubHost.mockResolvedValue(true)
    const res = await PUT(req({ clubId: 'club-tbs' }), params)
    expect(res.status).toBe(409)
    expect(p.event.update).not.toHaveBeenCalled()
  })

  it.each([['a club of the same city', 'club-ist-2'], ['a global club', 'club-global']])('moving it to %s is allowed and keeps the city', async (_label, clubId) => {
    const res = await PUT(req({ clubId }), params)
    expect(res.status).toBe(200)
    const data = p.event.update.mock.calls.at(-1)[0].data
    expect(data.clubId).toBe(clubId)
    expect(data).not.toHaveProperty('cityId')
  })

  it('a club that no longer exists is a 400, not a silent re-file', async () => {
    const res = await PUT(req({ clubId: 'club-gone' }), params)
    expect(res.status).toBe(400)
    expect(p.event.update).not.toHaveBeenCalled()
  })

  it('resaving with the same club does no club lookup', async () => {
    const res = await PUT(req({ clubId: 'club-ist', title: 'Picnic 2' }), params)
    expect(res.status).toBe(200)
    expect(p.club.findUnique).not.toHaveBeenCalled()
  })

  it('an event already filed under a global club can move to a club of its own city', async () => {
    p.event.findUnique.mockResolvedValue(existing({ clubId: 'club-global' }))
    const res = await PUT(req({ clubId: 'club-ist' }), params)
    expect(res.status).toBe(200)
  })
})

describe('edit pages offer only clubs the event may move to', () => {
  it('admin edit page filters the picker by the event city and keeps the current club', () => {
    const src = read('app/admin/events/[id]/edit/page.tsx')
    expect(src).toMatch(/if \(typeof event\.cityId === 'string'\) setEventCityId\(event\.cityId\)/)
    expect(src).toMatch(/clubs\.filter\(c => !eventCityId \|\| !c\.city \|\| c\.city\.id === eventCityId \|\| c\.id === form\.clubId\)/)
  })

  it('host edit page does the same', () => {
    const src = read('app/host/events/[id]/edit/page.tsx')
    expect(src).toMatch(/clubs\.filter\(c => !eventCityId \|\| !c\.city \|\| c\.city\.id === eventCityId \|\| c\.id === form\.clubId\)/)
  })

  it('the admin clubs API sends each club\'s city id for that filter', () => {
    expect(read('app/api/admin/clubs/route.ts')).toMatch(/city:\s+\{ select: \{ id: true, name: true, slug: true, country: true \} \}/)
  })
})
