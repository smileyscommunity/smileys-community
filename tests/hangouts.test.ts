import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/hangouts/route'
import { PATCH } from '@/app/api/hangouts/[id]/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isAdminOrModerator } from '@/lib/access'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  hangout: {
    create:     vi.fn(),
    findUnique: vi.fn(),
    update:     vi.fn(),
  },
} }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(() => true) }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/access', () => ({ isAdminOrModerator: vi.fn() }))

const req = (body: any) => ({ json: async () => body }) as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'User 1' })
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

describe('Hangouts PATCH', () => {
  const params = { params: Promise.resolve({ id: 'h1' }) }

  it('403 when not the host or admin', async () => {
    ;(prisma.hangout.findUnique as any).mockResolvedValue({
      id: 'h1',
      userId: 'u2', // someone else
      status: 'active'
    })
    ;(isAdminOrModerator as any).mockReturnValue(false)

    const res = await PATCH(req({ title: 'New Title' }), params)
    expect(res.status).toBe(403)
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
