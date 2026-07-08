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

describe('auth/me PATCH — name and nationality are mandatory', () => {
  it('rejects a blank name', async () => {
    const res = await PATCH(req({ name: '   ' }))
    expect(res.status).toBe(400)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects a single-word name (last name cleared)', async () => {
    const res = await PATCH(req({ name: 'Ayşe' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Last name is required')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('accepts a first + last name', async () => {
    const res = await PATCH(req({ name: 'Ayşe Kaya' }))
    expect(res.status).toBe(200)
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Ayşe Kaya' }) }),
    )
  })

  it.each([['', 'empty string'], [null, 'null'], ['   ', 'whitespace'], [42, 'non-string']])(
    'rejects clearing nationality with %s',
    async (value) => {
      const res = await PATCH(req({ nationality: value }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Nationality is required')
      expect(prisma.user.update).not.toHaveBeenCalled()
    },
  )

  it('accepts and trims a valid nationality', async () => {
    const res = await PATCH(req({ nationality: ' Turkey ' }))
    expect(res.status).toBe(200)
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nationality: 'Turkey' }) }),
    )
  })

  it('leaves name and nationality untouched when not in the payload', async () => {
    const res = await PATCH(req({ bio: 'hello' }))
    expect(res.status).toBe(200)
    const data = (prisma.user.update as any).mock.calls[0][0].data
    expect('name' in data).toBe(false)
    expect('nationality' in data).toBe(false)
  })
})
