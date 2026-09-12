import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/hangouts/route'
import { PATCH } from '@/app/api/hangouts/[id]/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canActInCity } from '@/lib/access'
import { createNotification } from '@/lib/notify'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  hangout: {
    create:     vi.fn(),
    findUnique: vi.fn(),
    update:     vi.fn(),
  },
  // POST resolves a cityId for every hangout, and falls back to the default
  // city when the session carries none (lib/city.ts). Without this the whole
  // create path throws before it ever reaches prisma.hangout.create.
  city: {
    findUnique: vi.fn(),
  },
  // The POST fan-out (fire-and-forget after the 201): host connections,
  // neighborhood locals, past joiners, then blocks drop pairs out.
  memberConnection: { findMany: vi.fn() },
  user:             { findMany: vi.fn() },
  hangoutJoin:      { findMany: vi.fn() },
  memberBlock:      { findMany: vi.fn() },
} }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(() => true) }))
// The route chains .catch() on it, so it must return a promise.
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/access', () => ({ canActInCity: vi.fn() }))
// Registry stand-in: any non-empty name is a real neighborhood of the city.
vi.mock('@/lib/neighborhoodsDb', () => ({
  safeNeighborhoodFor: vi.fn(async (_cityId: string, name: unknown) => (typeof name === 'string' && name ? name : null)),
}))

const req = (body: any) => ({ json: async () => body }) as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'User 1' })
  ;(prisma.city.findUnique as any).mockResolvedValue({ id: 'city-istanbul' })
  ;(prisma.memberConnection.findMany as any).mockResolvedValue([])
  ;(prisma.user.findMany as any).mockResolvedValue([])
  ;(prisma.hangoutJoin.findMany as any).mockResolvedValue([])
  ;(prisma.memberBlock.findMany as any).mockResolvedValue([])
})

describe('Hangouts POST — Max duration 24h', () => {
  it('400 when duration is > 24h', async () => {
    const now = new Date()
    const startsAt = now.toISOString()
    const endsAt   = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString()
    
    const res = await POST(req({
      title: 'Too long',
      location: 'Istanbul',
      startsAt,
      endsAt
    }))
    
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Max 24 hours per hangout')
  })

  it('201 when duration is exactly 24h', async () => {
    const now = new Date()
    const startsAt = now.toISOString()
    const endsAt   = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    
    ;(prisma.hangout.create as any).mockResolvedValue({ id: 'h1' })
    
    const res = await POST(req({
      title: 'Just right',
      location: 'Istanbul',
      startsAt,
      endsAt
    }))
    
    expect(res.status).toBe(201)
  })
})

describe('Hangouts POST — city scoping', () => {
  const body = () => {
    const now = new Date()
    return {
      title: 'Coffee',
      location: 'Istanbul',
      startsAt: now.toISOString(),
      endsAt:   new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    }
  }

  it('stamps the default city when the session carries none', async () => {
    ;(prisma.hangout.create as any).mockResolvedValue({ id: 'h1' })

    await POST(req(body()))
    expect(prisma.hangout.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cityId: 'city-istanbul' }),
    }))
  })

  it("uses the member's own city over the default", async () => {
    ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'User 1', cityId: 'city-berlin' })
    ;(prisma.hangout.create as any).mockResolvedValue({ id: 'h1' })

    await POST(req(body()))
    expect(prisma.hangout.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cityId: 'city-berlin' }),
    }))
  })
})

describe('Hangouts POST — notification fan-out', () => {
  it('pings connections, locals and past joiners, but never a blocked member', async () => {
    const now = new Date()
    ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'User 1', cityId: 'city-istanbul' })
    ;(prisma.hangout.create as any).mockResolvedValue({ id: 'h1', cityId: 'city-istanbul', title: 'Coffee', location: 'Moda Pier' })
    ;(prisma.memberConnection.findMany as any).mockResolvedValue([{ requesterId: 'u1', receiverId: 'friend' }])
    ;(prisma.user.findMany as any).mockResolvedValue([{ id: 'local' }, { id: 'blocked' }])
    ;(prisma.hangoutJoin.findMany as any).mockResolvedValue([{ userId: 'joiner' }])
    // The host blocked this local — they must not learn where the host will be.
    ;(prisma.memberBlock.findMany as any).mockResolvedValue([{ blockerId: 'u1', blockedId: 'blocked' }])

    const res = await POST(req({
      title: 'Coffee', location: 'Moda Pier', neighborhood: 'Kadıköy',
      startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    }))
    expect(res.status).toBe(201)

    // The fan-out runs after the response; wait for it to finish sending.
    await vi.waitFor(() => expect(createNotification).toHaveBeenCalledTimes(3))
    const recipients = (createNotification as any).mock.calls.map((c: any[]) => c[0])
    expect(recipients.sort()).toEqual(['friend', 'joiner', 'local'])
    expect(recipients).not.toContain('blocked')
    expect(recipients).not.toContain('u1')
    expect(createNotification).toHaveBeenCalledWith('friend', 'new_hangout', '☕ Hangout in Kadıköy', 'Coffee — Moda Pier', '/hangouts')
    // Locals are scoped to the hangout's city, not just the neighborhood name.
    expect((prisma.user.findMany as any).mock.calls[0][0].where).toMatchObject({ neighborhood: 'Kadıköy', cityId: 'city-istanbul' })
  })
})

describe('Hangouts PATCH', () => {
  const params = { params: Promise.resolve({ id: 'h1' }) }

  it('403 when not the host or admin', async () => {
    ;(prisma.hangout.findUnique as any).mockResolvedValue({
      id: 'h1',
      userId: 'u2', // someone else
      status: 'active'
    })
    ;(canActInCity as any).mockReturnValue(false)

    const res = await PATCH(req({ title: 'New Title' }), params)
    expect(res.status).toBe(403)
    expect(prisma.hangout.update).not.toHaveBeenCalled()
  })

  it('400 when duration > 24h on update', async () => {
    const now = new Date()
    ;(prisma.hangout.findUnique as any).mockResolvedValue({
      id: 'h1',
      userId: 'u1',
      status: 'active',
      startsAt: now,
      endsAt: new Date(now.getTime() + 1 * 60 * 60 * 1000),
      joins: []
    })

    const startsAt = now.toISOString()
    const endsAt   = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString()

    const res = await PATCH(req({ startsAt, endsAt }), params)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Max 24 hours per hangout')
  })

  it('updates meetMode correctly', async () => {
    ;(prisma.hangout.findUnique as any).mockResolvedValue({
      id: 'h1',
      userId: 'u1',
      status: 'active',
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 1000),
      joins: []
    })
    ;(prisma.hangout.update as any).mockResolvedValue({ id: 'h1' })

    await PATCH(req({ meetMode: 'solo' }), params)
    expect(prisma.hangout.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ meetMode: 'solo' })
    }))
  })
})
