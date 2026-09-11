import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/push',      () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email',     () => ({ sendSpotOpenedEmail: vi.fn().mockResolvedValue(undefined), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/eventQuota', () => ({ hasQuotaRoomFor: vi.fn(), quotaEventSelect: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  event:         { findUnique: vi.fn() },
  waitlistEntry: { findMany: vi.fn() },
  user:          { findMany: vi.fn() },
} }))

import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendPushToUser } from '@/lib/push'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { hasQuotaRoomFor } from '@/lib/eventQuota'
import { announceSpotOpened } from '@/lib/spotOpened'

// "Spot opened — claim it!" went to every waitlister on every approved
// cancel, including when the event was manually sold out or the only people
// waiting were on a side the quota had closed. They tapped Join and got a
// 409. The fan-out now asks the same questions the claim path will.

const p = prisma as any
const EVENT = { title: 'T', date: '2026-09-12', totalSpots: 20, soldOut: false, limitedSpots: true, genderBalance: false }

beforeEach(() => {
  vi.clearAllMocks()
  p.event.findUnique
    .mockResolvedValueOnce(EVENT)                 // the announce read
    .mockResolvedValueOnce({ spotsLeft: 1 })      // the post-recompute read
  p.waitlistEntry.findMany.mockResolvedValue([{ userId: 'w1' }, { userId: 'w2' }])
  p.user.findMany.mockResolvedValue([
    { id: 'w1', name: 'A', email: 'a@x', gender: 'male',   nationality: null },
    { id: 'w2', name: 'B', email: 'b@x', gender: 'female', nationality: null },
  ])
  ;(hasQuotaRoomFor as any).mockResolvedValue({ ok: true })
})

describe('announceSpotOpened', () => {
  it('recomputes first, then tells everyone who could claim', async () => {
    expect(await announceSpotOpened('e1')).toBe(2)
    expect(recomputeSpotsLeft).toHaveBeenCalledWith('e1', 20)
    expect(createNotification).toHaveBeenCalledTimes(2)
    expect(sendPushToUser).toHaveBeenCalledTimes(2)
  })

  it('stays silent on a manually sold-out event', async () => {
    p.event.findUnique.mockReset().mockResolvedValueOnce({ ...EVENT, soldOut: true })
    expect(await announceSpotOpened('e1')).toBe(0)
    expect(recomputeSpotsLeft).toHaveBeenCalled()   // the counter is still re-derived
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('stays silent when the recomputed counter shows no seat', async () => {
    p.event.findUnique.mockReset().mockResolvedValueOnce(EVENT).mockResolvedValueOnce({ spotsLeft: 0 })
    expect(await announceSpotOpened('e1')).toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('skips waitlisters whose side the quota has closed', async () => {
    ;(hasQuotaRoomFor as any).mockImplementation(async (_e: string, _ev: unknown, u: { gender: string }) =>
      u.gender === 'female' ? { ok: true } : { ok: false, reason: 'male_quota' })
    expect(await announceSpotOpened('e1')).toBe(1)
    expect((createNotification as any).mock.calls[0][0]).toBe('w2')
  })
})
