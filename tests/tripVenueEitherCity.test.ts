import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-10-01: the first real trip (Istanbul → Eskişehir) meets at
// Söğütlüçeşme station — a venue in the DEPARTURE city. A trip's venue is
// valid in either of its cities, and the pickers search both.
vi.mock('@/lib/prisma', () => ({ prisma: { business: { findFirst: vi.fn() } } }))
import { prisma } from '@/lib/prisma'
import { venueIdInput } from '@/lib/eventVenue'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('a trip may meet in either city', () => {
  beforeEach(() => { (prisma.business.findFirst as any).mockReset() })

  it('validates the listing against every city it is given', async () => {
    ;(prisma.business.findFirst as any).mockResolvedValue({ id: 'station' })
    expect(await venueIdInput('station', ['esk', 'ist'])).toEqual({ value: 'station' })
    expect((prisma.business.findFirst as any).mock.calls[0][0].where).toEqual({ id: 'station', cityId: { in: ['esk', 'ist'] }, isActive: true })
  })
  it('an ordinary event still accepts only its own city', async () => {
    ;(prisma.business.findFirst as any).mockResolvedValue(null)
    expect(await venueIdInput('elsewhere', 'ist')).toEqual({ error: 'That directory venue isn\'t listed in this event\'s city' })
    expect((prisma.business.findFirst as any).mock.calls[0][0].where.cityId).toEqual({ in: ['ist'] })
  })

  it('create/edit pass both trip cities; the search takes up to two', () => {
    expect(read('app/api/admin/events/route.ts')).toContain('venueIdInput(businessId, originCityId ? [placeCityId, originCityId] : placeCityId)')
    expect(read('app/api/admin/events/[id]/route.ts')).toContain('venueIdInput(body.businessId, eventCityIds(before))')
    const search = read('app/api/admin/events/venues/route.ts')
    expect(search).toContain(".getAll('city')")
    expect(search).toContain('.slice(0, 2)')
    expect(search).toContain('cityId: { in: cityIds }')
  })
  it('every form searches the departure city too on a trip', () => {
    expect(read('app/admin/events/new/page.tsx')).toContain("(tripDestination && clubCityOption ? `&city=${encodeURIComponent(clubCityOption.slug)}` : '')")
    expect(read('app/host/events/new/page.tsx')).toContain("(tripDestination && clubCity ? `&city=${encodeURIComponent(clubCity.slug)}` : '')")
    for (const p of ['app/admin/events/[id]/edit/page.tsx', 'app/host/events/[id]/edit/page.tsx'])
      expect(read(p)).toContain("(eventOriginCityId ? `&cityId=${encodeURIComponent(eventOriginCityId)}` : '')")
    expect(read('lib/db.ts')).toContain('originCityId:     e.originCityId ?? null,')
  })
})
