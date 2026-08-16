import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  city:             { findUnique: vi.fn() },
  cityRelationship: { findMany: vi.fn(), update: vi.fn() },
} }))
vi.mock('@/lib/email',  () => ({ sendCityLaunchEmail: vi.fn() }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { sendCityLaunchEmail } from '@/lib/email'
import { createNotification } from '@/lib/notify'
import { notifyCityLaunch } from '@/lib/cityLaunch'

const IZMIR = { name: 'Izmir', slug: 'izmir' }
const row = (id: string, userId: string) => ({
  id, user: { id: userId, name: `User ${userId}`, email: `${userId}@x.com` },
})

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.city.findUnique as any).mockResolvedValue(IZMIR)
  ;(prisma.cityRelationship.update as any).mockResolvedValue({})
  ;(sendCityLaunchEmail as any).mockResolvedValue(undefined)
  ;(createNotification as any).mockResolvedValue(undefined)
})

describe('notifyCityLaunch', () => {
  it('emails + bells every un-notified interested member and stamps notifiedAt', async () => {
    ;(prisma.cityRelationship.findMany as any).mockResolvedValue([row('r1', 'u1'), row('r2', 'u2')])
    const result = await notifyCityLaunch('c-izm')
    expect(result).toEqual({ notified: 2, failed: 0 })
    expect(sendCityLaunchEmail).toHaveBeenCalledTimes(2)
    expect(sendCityLaunchEmail).toHaveBeenCalledWith('u1@x.com', 'User u1', 'Izmir', 'izmir')
    expect(createNotification).toHaveBeenCalledTimes(2)
    expect(prisma.cityRelationship.update).toHaveBeenCalledTimes(2)
    // The dedupe guard is in the QUERY — only rows with notifiedAt null and
    // an approved user are fetched at all.
    expect(prisma.cityRelationship.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: 'interested', notifiedAt: null, user: { status: 'approved' } }),
    }))
  })

  it('one failing recipient does not stop the rest, and is not stamped as notified', async () => {
    ;(prisma.cityRelationship.findMany as any).mockResolvedValue([row('r1', 'u1'), row('r2', 'u2'), row('r3', 'u3')])
    ;(sendCityLaunchEmail as any)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('bounce'))
      .mockResolvedValueOnce(undefined)
    const result = await notifyCityLaunch('c-izm')
    expect(result).toEqual({ notified: 2, failed: 1 })
    // Only the two successes get notifiedAt — the failed row stays eligible
    // for a retry on the next flip.
    expect(prisma.cityRelationship.update).toHaveBeenCalledTimes(2)
    expect((prisma.cityRelationship.update as any).mock.calls.map((c: any) => c[0].where.id)).toEqual(['r1', 'r3'])
  })

  it('is a quiet no-op for an unknown city or an empty list', async () => {
    ;(prisma.city.findUnique as any).mockResolvedValue(null)
    expect(await notifyCityLaunch('nope')).toEqual({ notified: 0, failed: 0 })
    ;(prisma.city.findUnique as any).mockResolvedValue(IZMIR)
    ;(prisma.cityRelationship.findMany as any).mockResolvedValue([])
    expect(await notifyCityLaunch('c-izm')).toEqual({ notified: 0, failed: 0 })
    expect(sendCityLaunchEmail).not.toHaveBeenCalled()
  })
})
