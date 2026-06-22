import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
  createSession: vi.fn(async () => {}),
  deleteSession: vi.fn(),
}))
vi.mock('@/lib/access', () => ({ isClubHost: vi.fn(async () => false) }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { update: vi.fn() } } }))

import { PATCH } from '@/app/api/auth/me/route'
import { getSession } from '@/lib/session'
import { isClubHost } from '@/lib/access'
import { prisma } from '@/lib/prisma'

// sessionId set → handler uses the reuseSessionId branch, so req.headers
// is never read; a minimal req is enough.
const req = (body: any) => ({ json: async () => body, headers: { get: () => null } }) as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'U', email: 'u@x.com', role: 'member', color: '#000', sessionId: 's1' })
  ;(isClubHost as any).mockResolvedValue(false)
  ;(prisma.user.update as any).mockResolvedValue({ name: 'U', color: '#000' })
})

describe('auth/me PATCH — hosts cannot go private', () => {
  it('forces a host who sets connections-only back to everyone', async () => {
    ;(isClubHost as any).mockResolvedValue(true)
    const res = await PATCH(req({ profileVisibility: 'connections' }))
    expect(res.status).toBe(200)
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ profileVisibility: 'everyone' }) }),
    )
  })

  it('lets a non-host set connections-only', async () => {
    await PATCH(req({ profileVisibility: 'connections' }))
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ profileVisibility: 'connections' }) }),
    )
  })

  it('does not even check host status when setting everyone', async () => {
    await PATCH(req({ profileVisibility: 'everyone' }))
    expect(isClubHost).not.toHaveBeenCalled()
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ profileVisibility: 'everyone' }) }),
    )
  })
})
