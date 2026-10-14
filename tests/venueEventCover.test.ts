import { describe, it, expect, vi, beforeEach } from 'vitest'

// The fallback cover for a directory listing whose own website gave no photo:
// the newest event photo from that venue, in the listing's own city only.
const p = vi.hoisted(() => ({ event: { findMany: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))

import { eventCoverFor, normVenue } from '@/lib/venueEventCover'

const ev = (location: string, date: string, coverImage = `/c-${date}.jpg`) => ({ location, date, coverImage, title: `T ${date}` })

beforeEach(() => vi.clearAllMocks())

describe('eventCoverFor', () => {
  it('takes the newest photo for the venue, matching case and spacing loosely', async () => {
    p.event.findMany.mockResolvedValue([ev('other place', '2026-10-12'), ev('Warung  Nusantara', '2026-10-10'), ev('warung nusantara', '2026-09-01')])
    expect(await eventCoverFor({ name: 'Warung Nusantara', cityId: 'c1' })).toEqual({ url: '/c-2026-10-10.jpg', title: 'T 2026-10-10', date: '2026-10-10' })
  })

  it('looks only in the listing\'s own city, excluding cancelled events', async () => {
    p.event.findMany.mockResolvedValue([])
    await eventCoverFor({ name: 'X', cityId: 'c9' })
    expect(p.event.findMany.mock.calls[0][0].where).toEqual({ cityId: 'c9', coverImage: { not: null }, cancelledAt: null })
  })

  it('is null when no event was held there', async () => {
    p.event.findMany.mockResolvedValue([ev('Somewhere else', '2026-10-01')])
    expect(await eventCoverFor({ name: 'Warung Nusantara', cityId: 'c1' })).toBeNull()
  })

  it('uses the alias table so one venue entered two ways still matches', () => {
    expect(normVenue('Blak Yeldeğirmeni')).toBe(normVenue('BLAK Coffee Co. Yeldeğirmeni'))
  })
})
