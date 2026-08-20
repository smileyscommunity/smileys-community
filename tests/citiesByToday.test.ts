import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { city: { findMany: vi.fn() } } }))

import { prisma } from '@/lib/prisma'
import { citiesByToday } from '@/lib/city'
import { todayInTz } from '@/lib/cityTime'

// The network-wide sweeps each computed ONE "today" and applied it to every
// city. Right only while all cities share a zone. The reminder sweep archives
// events whose date has passed, so a city behind the founding one would have
// its events retired while that day was still running there.
//
// Grouping keeps the query count honest: cities in one zone share a group, so
// today's six Turkish cities are a single group and a single query — the same
// cost as before. A second zone is what buys the extra pass.

const cities = (rows: { id: string; timezone: string }[]) =>
  (prisma.city.findMany as any).mockResolvedValue(rows)

beforeEach(() => vi.clearAllMocks())

describe('citiesByToday', () => {
  it('puts cities sharing a zone in ONE group — no extra queries for the status quo', async () => {
    cities([
      { id: 'c-ist', timezone: 'Europe/Istanbul' },
      { id: 'c-bod', timezone: 'Europe/Istanbul' },
      { id: 'c-izm', timezone: 'Europe/Istanbul' },
    ])
    const groups = await citiesByToday()
    expect(groups).toHaveLength(1)
    expect(groups[0].cityIds.sort()).toEqual(['c-bod', 'c-ist', 'c-izm'])
    expect(groups[0].date).toBe(todayInTz('Europe/Istanbul'))
  })

  it('splits cities whose calendar day differs right now', async () => {
    // Kiritimati is UTC+14 and Niue UTC-11: 25 hours apart, so their dates
    // cannot coincide whenever this test runs.
    cities([
      { id: 'c-far',  timezone: 'Pacific/Kiritimati' },
      { id: 'c-near', timezone: 'Pacific/Niue' },
    ])
    const groups = await citiesByToday()
    expect(groups).toHaveLength(2)
    const dates = groups.map(g => g.date).sort()
    expect(dates[0]).not.toBe(dates[1])
  })

  it('gives each group the date for its OWN zone, not the first one seen', async () => {
    cities([
      { id: 'c-ist', timezone: 'Europe/Istanbul' },
      { id: 'c-nyc', timezone: 'America/New_York' },
    ])
    for (const g of await citiesByToday()) {
      const tz = g.cityIds.includes('c-ist') ? 'Europe/Istanbul' : 'America/New_York'
      expect(g.date).toBe(todayInTz(tz))
    }
  })

  it('carries the day offset into every group', async () => {
    cities([{ id: 'c-ist', timezone: 'Europe/Istanbul' }])
    expect((await citiesByToday(1))[0].date).toBe(todayInTz('Europe/Istanbul', 1))
    expect((await citiesByToday(-3))[0].date).toBe(todayInTz('Europe/Istanbul', -3))
  })

  it('includes every city, not just live ones — a paused city still needs its rows maintained', async () => {
    cities([{ id: 'c-a', timezone: 'Europe/Istanbul' }, { id: 'c-b', timezone: 'Europe/Istanbul' }])
    await citiesByToday()
    const where = (prisma.city.findMany as any).mock.calls[0][0]?.where
    expect(where, 'filtering by status would skip paused cities').toBeUndefined()
  })

  it('returns nothing to iterate when there are no cities, rather than a bare date', async () => {
    cities([])
    expect(await citiesByToday()).toEqual([])
  })
})
