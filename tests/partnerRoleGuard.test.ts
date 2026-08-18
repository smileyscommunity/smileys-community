import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock everything the route handlers reach so we test only their control flow.
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    partner: { findUnique: vi.fn() },
    user:    { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))

import { POST, DELETE } from '@/app/api/admin/partners/[id]/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

// Assigning a partner account writes `role` on the target user, and the gate
// on this route (`canManagePartners`) admits moderators — while the rule stated
// in /api/admin/users/[id] is that moderators may suspend and warn, never
// change roles. So a moderator could POST the admin's id here and overwrite
// `role: 'admin'` with `'partner'`. Production has one admin and four
// moderators, which made that a one-request lockout of every admin surface,
// unlogged because POST wrote no audit row.
//
// Never an escalation — `partner` ranks below `moderator`, so assigning
// yourself only demotes you. The demotion of someone else was the whole risk.

const params = { params: Promise.resolve({ id: 'p1' }) }
const req = (body: any = {}) => ({ json: async () => body }) as any

const MODERATOR = { id: 'm1', role: 'moderator', name: 'Mod' }
const ADMIN     = { id: 'a1', role: 'admin',     name: 'Admin' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(MODERATOR)
  ;(prisma.partner.findUnique as any).mockResolvedValue({ id: 'p1', name: 'Kahve Dünyası' })
  ;(prisma.user.update as any).mockImplementation(async ({ select }: any) =>
    select ? { id: 'u1', name: 'Target', email: 't@x.com' } : {})
})

const target = (role: string, extra: Record<string, unknown> = {}) =>
  (prisma.user.findUnique as any).mockResolvedValue({
    role, name: 'Target', email: 't@x.com', partnerId: 'p1', ...extra,
  })

describe('POST /admin/partners/[id] — assigning a user', () => {
  it('refuses to overwrite the admin account — the lockout this closes', async () => {
    target('admin')
    const res = await POST(req({ userId: 'a1' }), params)
    expect(res.status).toBe(403)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a fellow moderator', async () => {
    target('moderator')
    const res = await POST(req({ userId: 'm2' }), params)
    expect(res.status).toBe(403)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('still lets a moderator assign an ordinary member — the workflow is intact', async () => {
    target('member')
    const res = await POST(req({ userId: 'u1' }), params)
    expect(res.status).toBe(200)
    expect((prisma.user.update as any).mock.calls[0][0].data)
      .toEqual({ partnerId: 'p1', role: 'partner' })
  })

  it('lets a moderator reassign an existing partner account', async () => {
    target('partner')
    expect((await POST(req({ userId: 'u1' }), params)).status).toBe(200)
  })

  it('lets an admin assign an elevated account — the rule limits moderators, not admins', async () => {
    ;(getSession as any).mockResolvedValue(ADMIN)
    target('moderator')
    expect((await POST(req({ userId: 'm2' }), params)).status).toBe(200)
  })

  it('logs the assignment with the role it overwrote', async () => {
    target('member')
    await POST(req({ userId: 'u1' }), params)
    const [, , action, targetId, targetType, meta] = (writeAudit as any).mock.calls[0]
    expect(action).toBe('partner.assign_user')
    expect(targetId).toBe('u1')
    expect(targetType).toBe('user')
    expect(meta.previousRole).toBe('member')
  })

  it('404s on an unknown user instead of throwing P2025 out of prisma.update', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    const res = await POST(req({ userId: 'ghost' }), params)
    expect(res.status).toBe(404)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects a signed-out caller', async () => {
    ;(getSession as any).mockResolvedValue(null)
    expect((await POST(req({ userId: 'u1' }), params)).status).toBe(403)
  })

  it('rejects a plain member — the outer gate still stands', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'u9', role: 'member', name: 'Nobody' })
    expect((await POST(req({ userId: 'u1' }), params)).status).toBe(403)
  })
})

describe('DELETE /admin/partners/[id] — unassigning a user', () => {
  it('unassigns a partner and demotes them to member', async () => {
    target('partner')
    const res = await DELETE(req({ userId: 'u1' }), params)
    expect(res.status).toBe(200)
    expect((prisma.user.update as any).mock.calls[0][0].data)
      .toEqual({ partnerId: null, role: 'member' })
  })

  it('refuses to demote an elevated account even if one carries a partnerId', async () => {
    target('admin')
    const res = await DELETE(req({ userId: 'a1' }), params)
    expect(res.status).toBe(403)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('404s when the account is not assigned to THIS partner', async () => {
    target('partner', { partnerId: 'p2' })
    const res = await DELETE(req({ userId: 'u1' }), params)
    expect(res.status).toBe(404)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})
