import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit',   () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/email',   () => ({ recordEmailFailure: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:       vi.fn(async (ops: any) => Promise.all(ops)),
  report:             { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  user:               { findUnique: vi.fn(), update: vi.fn() },
  clubMembership:     { findMany: vi.fn().mockResolvedValue([]) },
  club:               { update: vi.fn() },
  blacklist:          { upsert: vi.fn().mockResolvedValue({}) },
  passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
} }))

import { PATCH } from '@/app/api/admin/moderation/[id]/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

// A report whose reported user has since been deleted: the city-scope check
// was skipped when the user was null, then `warn` ran prisma.user.update on
// the missing id and 500'd — after the report row had been marked actioned.

const p = prisma as any
const req = (body: any) => ({ json: async () => body }) as any
const params = { params: Promise.resolve({ id: 'r1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  p.report.findUnique.mockResolvedValue({ id: 'r1', reportedId: 'gone', reporterId: 'x', status: 'pending', reason: 'spam' })
  p.user.findUnique.mockResolvedValue(null)
})

describe('PATCH /api/admin/moderation/[id] on a deleted user', () => {
  it('admin warn → 404, and the report is not marked actioned', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'adm', name: 'A', role: 'admin', cityId: 'c1' })
    const res = await PATCH(req({ action: 'warn' }), params)
    expect(res.status).toBe(404)
    expect(p.report.update).not.toHaveBeenCalled()
    expect(p.user.update).not.toHaveBeenCalled()
  })
  it('admin can still dismiss it', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'adm', name: 'A', role: 'admin', cityId: 'c1' })
    const res = await PATCH(req({ action: 'dismiss' }), params)
    expect(res.status).toBe(200)
    expect(p.report.update).toHaveBeenCalled()
  })
  it('a moderator fails closed', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'mod', name: 'M', role: 'moderator', cityId: 'c1' })
    const res = await PATCH(req({ action: 'warn' }), params)
    expect(res.status).toBe(403)
    expect(p.report.update).not.toHaveBeenCalled()
  })
})
