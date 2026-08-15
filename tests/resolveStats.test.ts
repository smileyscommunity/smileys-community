import { describe, it, expect, vi, beforeEach } from 'vitest'

// The whole point of `metric` rows is that a published number can't go stale.
// These pin that a metric row ignores whatever value is stored beside it.
vi.mock('@/lib/prisma', () => ({ prisma: {
  user:  { count: vi.fn() },
  event: { count: vi.fn() },
  club:  { count: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { resolveStats } from '@/lib/communityStats'

beforeEach(() => {
  vi.resetModules()
  ;(prisma.user.count  as any).mockResolvedValue(1442)
  ;(prisma.event.count as any).mockResolvedValue(216)
  ;(prisma.club.count  as any).mockResolvedValue(147)
})

describe('resolveStats', () => {
  it('leaves editorial rows exactly as typed', async () => {
    const out = await resolveStats([{ value: '4,000+', label: 'in our WhatsApp groups' }])
    expect(out).toEqual([{ value: '4,000+', label: 'in our WhatsApp groups' }])
  })

  it('replaces a metric row with the measured, rounded-down figure', async () => {
    const out = await resolveStats([{ label: 'Active clubs', metric: 'clubs' }])
    expect(out).toEqual([{ value: '140+', label: 'Active clubs' }])
  })

  it('ignores a stale value sitting beside a metric — the database wins', async () => {
    const out = await resolveStats([{ value: '120+', label: 'Active clubs', metric: 'clubs' }])
    expect(out[0].value).toBe('140+')
  })

  it('mixes editorial and measured rows in one strip', async () => {
    const out = await resolveStats([
      { value: '4,000+', label: 'in our WhatsApp groups' },
      { label: 'Active clubs', metric: 'clubs' },
    ])
    expect(out.map(r => r.value)).toEqual(['4,000+', '140+'])
  })
})
