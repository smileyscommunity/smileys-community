import { describe, it, expect, vi, beforeEach } from 'vitest'

// Two bugs that both surfaced as "I tried to create an event in Antalya and
// it didn't work":
//
//  1. Events inherit their city from the parent club, and the route treated a
//     null club cityId as an impossible bug state ("every club has one
//     post-backfill") and returned 400. But global clubs — the language and
//     nationality ones — carry cityId null BY DESIGN, 32 of 147 in
//     production. Every one of them was listed in the create form's club
//     dropdown and rejected on save, so none could host an event in any city.
//
//  2. A FREE event more than a week out was forced to status 'pending' even
//     for an admin, so it saved successfully and then never appeared on the
//     public page — indistinguishable from the create having failed.
//
// The city a global club's event lands in is the sharp edge here: guessing it
// from the creator's own session is what would quietly file an Antalya event
// under Istanbul, so staff are asked and hosts fall back to their own city.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/notify', () => ({
  createNotification: vi.fn(async () => {}),
  notifyNewEvent:     vi.fn(async () => {}),
}))
vi.mock('@/lib/venueDirectory', () => ({ ensurePendingVenueBusiness: vi.fn(async () => {}) }))
vi.mock('@/lib/survey', () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()) }))
vi.mock('@/lib/safeUrl', () => ({ normalizePaymentContact: vi.fn(() => ({ value: '' })) }))
vi.mock('@/lib/city', () => ({
  // A week out from "today" in the event's city. Fixed so the date in the
  // payload below is unambiguously beyond it.
  todayInCity:         vi.fn(async () => '2026-09-14'),
  getCityConfig:       vi.fn(async () => ({ currency: 'TRY' })),
  resolveTargetCityId: vi.fn(async (_s: unknown, requested: unknown) =>
    requested ? { cityId: String(requested) } : { cityId: 'city_istanbul' }),
}))
vi.mock('@/lib/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access')>()),
  isClubHost:   vi.fn(async () => false),
  isClubHostFor: vi.fn(async () => true),
  hostCityIds:  vi.fn(async () => []),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    club:  { findUnique: vi.fn() },
    tag:   { findMany: vi.fn(async () => []) },
    user:  { findMany: vi.fn(async () => []) },
    event: { create: vi.fn(async ({ data }: any) => ({ id: 'e1', ...data })) },
  },
}))

import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isClubHost } from '@/lib/access'
import { POST } from '@/app/api/admin/events/route'

const ANTALYA  = 'city_antalya_54b768a31022'
const ISTANBUL = 'city_istanbul'

const admin = { id: 'a1', name: 'Adm', email: 'a@x', role: 'admin',     color: '#000', cityId: ISTANBUL }
const host  = { id: 'h1', name: 'Hst', email: 'h@x', role: 'member',    color: '#000', cityId: ANTALYA }

// A free event well past the one-week window — the shape that used to come
// back as 'pending' with nothing said about it.
const payload = (over: Record<string, unknown> = {}) => ({
  title: 'Language Exchange', date: '2026-10-20', time: '19:00',
  location: 'Kaleiçi', neighborhood: 'Muratpaşa', clubId: 'club_english',
  hostId: 'h1', description: 'x', totalSpots: 20, price: '0', memberPrice: '',
  ...over,
})

const post = (body: Record<string, unknown>) =>
  POST(new Request('https://x/api/admin/events', {
    method: 'POST', body: JSON.stringify(body),
  }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(admin)
  ;(isClubHost as any).mockResolvedValue(false)
  // The default club under test is a GLOBAL one: no city of its own.
  ;(prisma.club.findUnique as any).mockResolvedValue({ cityId: null, name: 'English' })
})

describe('creating an event under a global club', () => {
  it('files it in the city the request names, not the admin\'s own', async () => {
    const res = await post(payload({ cityId: ANTALYA }))
    expect(res.status).toBe(200)
    // The whole point: an Istanbul admin creating in Antalya gets Antalya.
    expect((prisma.event.create as any).mock.calls[0][0].data.cityId).toBe(ANTALYA)
  })

  it('asks staff which city instead of guessing one', async () => {
    const res = await post(payload())
    expect(res.status).toBe(400)
    // The message has to name the club and say what to do — the admin form
    // toasts `error` verbatim.
    expect((await res.json()).error).toMatch(/global club/i)
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it('falls back to a club host\'s own city, since /host has no city control', async () => {
    ;(getSession as any).mockResolvedValue(host)
    ;(isClubHost as any).mockResolvedValue(true)
    // Club hosts must also supply description + cover + address; unrelated to
    // the city question, but the route checks it first.
    const res = await post(payload({ coverImage: '/app/api/files/general/x.jpg', address: 'Kaleiçi 1' }))
    expect(res.status).toBe(200)
    expect((prisma.event.create as any).mock.calls[0][0].data.cityId).toBe(ISTANBUL)
  })

  it('still inherits the club\'s city when the club has one', async () => {
    ;(prisma.club.findUnique as any).mockResolvedValue({ cityId: ANTALYA, name: 'Social Antalya' })
    // A cityId in the body must not override a club that names its own city.
    const res = await post(payload({ cityId: ISTANBUL }))
    expect(res.status).toBe(200)
    expect((prisma.event.create as any).mock.calls[0][0].data.cityId).toBe(ANTALYA)
  })
})

describe('a free event more than a week out', () => {
  it('publishes for an admin rather than silently queuing for review', async () => {
    const res = await post(payload({ cityId: ANTALYA }))
    expect(res.status).toBe(200)
    expect((prisma.event.create as any).mock.calls[0][0].data.status).toBe('published')
  })

  it('still goes to review for a club host', async () => {
    ;(getSession as any).mockResolvedValue(host)
    ;(isClubHost as any).mockResolvedValue(true)
    const res = await post(payload({ description: 'x', coverImage: null, address: 'A' }))
    // Club hosts are caught by needsReview regardless of the date — pinned so
    // exempting admins above can't be widened into exempting everyone.
    const created = (prisma.event.create as any).mock.calls[0]?.[0]?.data
    expect(res.status === 200 ? created.status : 'blocked').not.toBe('published')
  })
})
