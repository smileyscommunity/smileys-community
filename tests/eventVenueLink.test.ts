import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// An event links to its directory listing by id (Event.businessId), picked in
// the event form. It used to be the venue NAME, re-matched on every read, so
// 16 of 29 upcoming events linked nothing: "Dozze" never found "Dozze
// Kadıköy", "Roastory Coffee Co Istiklal Caddesi" never found "Roastory
// Coffee". These pin the write side (a pick is checked against the event's
// city; no pick links the name's listing or a pending stub) and that no
// reader went back to matching names.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/notify', () => ({
  createNotification: vi.fn(async () => {}),
  notifyNewEvent:     vi.fn(async () => {}),
}))
vi.mock('@/lib/venueDirectory', () => ({ ensurePendingVenueBusiness: vi.fn(async () => 'biz_stub') }))
vi.mock('@/lib/survey', () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()) }))
vi.mock('@/lib/safeUrl', () => ({ normalizePaymentContact: vi.fn(() => ({ value: '' })) }))
vi.mock('@/lib/city', () => ({
  todayInCity:         vi.fn(async () => '2026-09-14'),
  getCityConfig:       vi.fn(async () => ({ currency: 'TRY' })),
  resolveTargetCityId: vi.fn(async () => ({ cityId: 'city_istanbul' })),
}))
vi.mock('@/lib/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access')>()),
  isClubHost:    vi.fn(async () => false),
  isClubHostFor: vi.fn(async () => true),
  hostCityIds:   vi.fn(async () => []),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    club:     { findUnique: vi.fn(async () => ({ cityId: 'city_istanbul', name: 'Social' })) },
    tag:      { findMany: vi.fn(async () => []) },
    user:     { findMany: vi.fn(async () => []) },
    business: { findFirst: vi.fn() },
    event:    {
      create: vi.fn(async ({ data }: any) => ({ id: 'e1', ...data })),
      update: vi.fn(async () => ({})),
    },
  },
}))

import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { ensurePendingVenueBusiness } from '@/lib/venueDirectory'
import { venueIdInput } from '@/lib/eventVenue'
import { POST } from '@/app/api/admin/events/route'

const admin = { id: 'a1', name: 'Adm', email: 'a@x', role: 'admin', color: '#000', cityId: 'city_istanbul' }
const payload = (over: Record<string, unknown> = {}) => ({
  title: 'Coffee', date: '2026-09-16', time: '19:00',
  location: 'Dozze', neighborhood: 'Kadıköy', clubId: 'club_social',
  hostId: 'a1', description: 'x', totalSpots: 20, price: '0', memberPrice: '',
  ...over,
})
const post = (body: Record<string, unknown>) =>
  POST(new Request('https://x/api/admin/events', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(admin)
})

describe('venueIdInput', () => {
  it('passes "not said" and "none" through without a lookup', async () => {
    expect(await venueIdInput(undefined, 'c')).toEqual({ value: undefined })
    expect(await venueIdInput(null, 'c')).toEqual({ value: null })
    expect(await venueIdInput('', 'c')).toEqual({ value: null })
    expect(prisma.business.findFirst).not.toHaveBeenCalled()
  })

  it('only accepts an active listing in the event\'s own city', async () => {
    ;(prisma.business.findFirst as any).mockResolvedValueOnce(null)
    expect(await venueIdInput('biz_izmir', 'city_istanbul')).toHaveProperty('error')
    expect((prisma.business.findFirst as any).mock.calls[0][0].where).toMatchObject({ id: 'biz_izmir', cityId: 'city_istanbul', isActive: true })
    ;(prisma.business.findFirst as any).mockResolvedValueOnce({ id: 'biz_dozze' })
    expect(await venueIdInput('biz_dozze', 'city_istanbul')).toEqual({ value: 'biz_dozze' })
    expect(await venueIdInput(42, 'city_istanbul')).toHaveProperty('error')
  })
})

describe('creating an event', () => {
  it('stores the picked listing and files no stub', async () => {
    ;(prisma.business.findFirst as any).mockResolvedValueOnce({ id: 'biz_dozze' })
    const res = await post(payload({ businessId: 'biz_dozze' }))
    expect(res.status).toBe(200)
    expect((prisma.event.create as any).mock.calls[0][0].data.businessId).toBe('biz_dozze')
    expect(ensurePendingVenueBusiness).not.toHaveBeenCalled()
  })

  it('refuses a listing from another city before creating anything', async () => {
    ;(prisma.business.findFirst as any).mockResolvedValueOnce(null)
    const res = await post(payload({ businessId: 'biz_izmir' }))
    expect(res.status).toBe(400)
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it('without a pick, links the listing the venue name has (or a pending stub)', async () => {
    const res = await post(payload({ businessId: null }))
    expect(res.status).toBe(200)
    expect((prisma.event.create as any).mock.calls[0][0].data.businessId).toBeNull()
    expect((ensurePendingVenueBusiness as any).mock.calls[0][0]).toMatchObject({ location: 'Dozze', cityId: 'city_istanbul' })
    expect(prisma.event.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { businessId: 'biz_stub' } })
  })
})

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('readers follow the link, not the name', () => {
  const READERS = [
    'app/events/[id]/page.tsx',
    'app/directory/[id]/page.tsx',
    'app/api/events/[id]/feedback/route.ts',
    'app/api/cron/sweep-review-nudges/route.ts',
    'app/(member)/dashboard/page.tsx',
  ]
  it.each(READERS)('%s does not match a venue by name', (file) => {
    const s = src(file)
    // The old matchers: equals-insensitive on the business name or the event
    // location, and the sweep's alias map.
    expect(s).not.toMatch(/location[^\n]*mode: 'insensitive'/)
    expect(s).not.toMatch(/equals: business\.name/)
    expect(s).not.toMatch(/const ALIAS/)
    expect(s).not.toMatch(/matchDirectoryVenue/)
  })

  it('the event API names the linked listing only to viewers who see the exact location', () => {
    const s = src('app/api/events/[id]/route.ts')
    const venueAt = s.indexOf('venue:')
    // After both redacted returns (guest, and member not on the event).
    expect(venueAt).toBeGreaterThan(s.indexOf('redactEventForGuest(event)'))
    expect(venueAt).toBeGreaterThan(s.indexOf('lat: null, lng: null'))
  })

  it('a duplicated event keeps its listing', async () => {
    const { DUPLICATE_COPIED_FIELDS } = await import('@/lib/eventDuplicate')
    expect(DUPLICATE_COPIED_FIELDS).toContain('businessId')
  })
})
