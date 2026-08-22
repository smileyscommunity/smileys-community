import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock everything the route handlers reach so we test only their control flow.
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    club:           { findUnique: vi.fn(), update: vi.fn() },
    clubMembership: { findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), delete: vi.fn() },
    // The join/leave paths pair the membership write with the memberCount
    // update in a $transaction([...]) — the array form resolves each op's
    // promise, which the individual mocks above already produce.
    $transaction:   vi.fn(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(undefined)),
  },
}))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))

import { PATCH, DELETE } from '@/app/api/clubs/[slug]/membership/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const params = { params: Promise.resolve({ slug: 'social' }) }
const req = (body: any = {}) => ({ json: async () => body }) as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', role: 'member', name: 'U' })
  ;(prisma.club.findUnique as any).mockResolvedValue({ id: 'c1', slug: 'social' })
})

describe('PATCH /clubs/[slug]/membership — step down as host', () => {
  it('rejects a role other than member', async () => {
    const res = await PATCH(req({ role: 'host' }), params)
    expect(res.status).toBe(400)
  })

  it('rejects when the caller is not a host', async () => {
    ;(prisma.clubMembership.findUnique as any).mockResolvedValue({ role: 'member', status: 'approved' })
    const res = await PATCH(req({ role: 'member' }), params)
    expect(res.status).toBe(400)
    expect(prisma.clubMembership.update).not.toHaveBeenCalled()
  })

  it('blocks the LAST host from stepping down (orphan guard)', async () => {
    ;(prisma.clubMembership.findUnique as any).mockResolvedValue({ role: 'host', status: 'approved' })
    ;(prisma.clubMembership.count as any).mockResolvedValue(1)
    const res = await PATCH(req({ role: 'member' }), params)
    expect(res.status).toBe(400)
    expect(prisma.clubMembership.update).not.toHaveBeenCalled()
  })

  it('demotes host → member when another host remains', async () => {
    ;(prisma.clubMembership.findUnique as any).mockResolvedValue({ role: 'host', status: 'approved' })
    ;(prisma.clubMembership.count as any).mockResolvedValue(2)
    ;(prisma.clubMembership.update as any).mockResolvedValue({})
    const res = await PATCH(req({ role: 'member' }), params)
    expect(res.status).toBe(200)
    expect(prisma.clubMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'member' } }),
    )
  })
})

describe('DELETE /clubs/[slug]/membership — leave club', () => {
  it('blocks the last host from leaving (orphan guard)', async () => {
    ;(prisma.clubMembership.findUnique as any).mockResolvedValue({ role: 'host', status: 'approved' })
    ;(prisma.clubMembership.count as any).mockResolvedValue(1)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(400)
    expect(prisma.clubMembership.delete).not.toHaveBeenCalled()
  })

  it('approved member leaving decrements memberCount', async () => {
    ;(prisma.clubMembership.findUnique as any).mockResolvedValue({ role: 'member', status: 'approved' })
    ;(prisma.clubMembership.delete as any).mockResolvedValue({})
    ;(prisma.club.update as any).mockResolvedValue({})
    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(prisma.clubMembership.delete).toHaveBeenCalled()
    expect(prisma.club.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { memberCount: { decrement: 1 } } }),
    )
  })

  it('pending member leaving does NOT decrement the count', async () => {
    ;(prisma.clubMembership.findUnique as any).mockResolvedValue({ role: 'member', status: 'pending' })
    ;(prisma.clubMembership.delete as any).mockResolvedValue({})
    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(prisma.club.update).not.toHaveBeenCalled()
  })
})
