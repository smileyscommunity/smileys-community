import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Cross-city trips, phase 3: the day after a trip, the people who went are
// invited to add the city they visited.
vi.mock('@/lib/prisma', () => ({ prisma: {
  city:             { findUnique: vi.fn() },
  eventCoHost:      { findMany: vi.fn() },
  user:             { findMany: vi.fn() },
  cityRelationship: { findMany: vi.fn() },
} }))
vi.mock('@/lib/rateLimit', () => ({ claimOnce: vi.fn(async () => true) }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => true) }))

import { prisma } from '@/lib/prisma'
import { claimOnce } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { sendTripCityInvites, tripCityInvitees, tripCityInviteMessage } from '@/lib/tripFollowUp'

const p = prisma as any
const trip = { id: 'e1', cityId: 'esk', originCityId: 'ist', hostId: 'host', attendeeIds: ['a', 'b', 'local', 'joined'] }

beforeEach(() => {
  vi.clearAllMocks()
  p.city.findUnique.mockResolvedValue({ name: 'Eskişehir', slug: 'eskisehir', status: 'live' })
  p.eventCoHost.findMany.mockResolvedValue([{ userId: 'co' }])
  p.user.findMany.mockResolvedValue([{ id: 'local' }])                 // already lives there
  p.cityRelationship.findMany.mockResolvedValue([{ userId: 'joined' }]) // already joined it
})

describe('trip city invites', () => {
  it('goes to the travellers — attendees, host, co-hosts — not anyone already in the city', async () => {
    expect(await sendTripCityInvites(trip)).toBe(4)
    const sentTo = (createNotification as any).mock.calls.map((c: any[]) => c[0]).sort()
    expect(sentTo).toEqual(['a', 'b', 'co', 'host'])
    const [, type, title, , link] = (createNotification as any).mock.calls[0]
    expect(type).toBe('city_launch')
    expect(title).toBe("You've been to Eskişehir 🚆")
    expect(link).toBe('/eskisehir')
  })
  it('once per person per trip', async () => {
    await sendTripCityInvites(trip)
    expect((claimOnce as any).mock.calls.map((c: any[]) => c[0])).toContain('trip-city-invite:e1:a')
    ;(claimOnce as any).mockResolvedValue(false)
    ;(createNotification as any).mockClear()
    expect(await sendTripCityInvites(trip)).toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
  })
  it('nothing for an ordinary event, or a city that is no longer live', async () => {
    expect(await sendTripCityInvites({ ...trip, originCityId: null })).toBe(0)
    p.city.findUnique.mockResolvedValue({ name: 'Eskişehir', slug: 'eskisehir', status: 'paused' })
    expect(await sendTripCityInvites(trip)).toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
  })
  it('never throws into the survey sweep', async () => {
    p.city.findUnique.mockRejectedValue(new Error('db down'))
    await expect(sendTripCityInvites(trip)).resolves.toBe(0)
  })
  it('pure helpers', () => {
    expect(tripCityInvitees(['a', 'a', 'b', 'x'], new Set(['x']))).toEqual(['a', 'b'])
    expect(tripCityInviteMessage('Bursa').body).toContain('Add Bursa to your cities')
  })
  it('runs from the survey sweep, after the surveys, for the same people', () => {
    const sweep = readFileSync(join(__dirname, '../app/api/cron/sweep-event-surveys/route.ts'), 'utf8')
    expect(sweep).toContain('hostId: true, cityId: true, originCityId: true },')
    expect(sweep).toContain('await sendTripCityInvites({ id: event.id, cityId: event.cityId, originCityId: event.originCityId, hostId: event.hostId, attendeeIds: targets })')
  })
})
