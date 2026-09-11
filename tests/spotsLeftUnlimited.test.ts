import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  event:         { findUnique: vi.fn() },
  eventCoHost:   { findMany: vi.fn().mockResolvedValue([]) },
  eventAttendee: { count: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { expectedSpotsLeft } from '@/lib/spotsLeft'

const p = prisma as any

// The card derives "X going" from totalSpots − spotsLeft. On an unlimited
// event the recompute clamped at 0, which froze "going" at the nominal total
// and quietly re-opened a cap the host never set.
describe('expectedSpotsLeft', () => {
  it('clamps at zero for a limited event', async () => {
    p.event.findUnique.mockResolvedValue({ hostId: 'h', limitedSpots: true })
    p.eventAttendee.count.mockResolvedValue(25)
    expect(await expectedSpotsLeft('e1', 20)).toBe(0)
  })
  it('keeps tallying below zero for an unlimited event', async () => {
    p.event.findUnique.mockResolvedValue({ hostId: 'h', limitedSpots: false })
    p.eventAttendee.count.mockResolvedValue(25)
    expect(await expectedSpotsLeft('e1', 20)).toBe(-5)
  })
})
