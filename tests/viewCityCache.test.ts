import { describe, it, expect, vi, beforeEach } from 'vitest'

const cookieValue = { current: '' }
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: cookieValue.current }) }) }))
vi.mock('@/lib/prisma', () => ({ prisma: { city: { findFirst: vi.fn(), findUnique: vi.fn() } } }))

import { prisma } from '@/lib/prisma'
import { getViewCityId } from '@/lib/city'

// The view-city cookie is client-controlled. The cache keyed on its raw value
// and remembered every miss, so a scraper sending a fresh cookie per request
// grew the Map without bound and cost one DB query per novel value.

const p = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  p.city.findFirst.mockResolvedValue(null)
})

describe('getViewCityId', () => {
  it('rejects a value not shaped like a slug without touching the DB', async () => {
    cookieValue.current = 'x'.repeat(200)
    expect(await getViewCityId()).toBeNull()
    cookieValue.current = "izmir'; drop table"
    expect(await getViewCityId()).toBeNull()
    expect(p.city.findFirst).not.toHaveBeenCalled()
  })

  it('does not cache a miss', async () => {
    cookieValue.current = 'nowhere-1'
    expect(await getViewCityId()).toBeNull()
    expect(await getViewCityId()).toBeNull()
    expect(p.city.findFirst).toHaveBeenCalledTimes(2)
  })

  it('caches a hit', async () => {
    p.city.findFirst.mockResolvedValue({ id: 'izmir-id' })
    cookieValue.current = 'izmir'
    expect(await getViewCityId()).toBe('izmir-id')
    expect(await getViewCityId()).toBe('izmir-id')
    expect(p.city.findFirst).toHaveBeenCalledTimes(1)
  })
})
