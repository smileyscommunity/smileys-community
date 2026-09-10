import { describe, it, expect, vi, beforeEach } from 'vitest'

// Banning from the reports queue set status='banned' and stopped there. The
// users route also blacklists the email/phone (so a re-application with a
// new email and the same phone is caught) and kills outstanding reset /
// activation links. Same ban, same follow-ups — and the live cookie is
// revoked through tokenVersion rather than at the next login.

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
  passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
} }))

import { PATCH } from '@/app/api/admin/moderation/[id]/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const p = prisma as any
const req = (body: any) => ({ json: async () => body }) as any
const params = { params: Promise.resolve({ id: 'r1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'adm', name: 'Admin', role: 'admin', cityId: 'c1' })
  p.report.findUnique.mockResolvedValue({ id: 'r1', reportedId: 'bad', status: 'pending' })
  p.user.findUnique.mockResolvedValue({ id: 'bad', name: 'Bad Actor', status: 'approved', cityId: 'c1' })
  p.user.update.mockResolvedValue({ email: 'bad@example.com', phone: '+90555', name: 'Bad Actor' })
})

describe('PATCH /api/admin/moderation/[id] action=ban', () => {
  it('bans, revokes the session, blacklists, and clears reset tokens', async () => {
    const res = await PATCH(req({ action: 'ban', reviewNote: 'spam' }), params)
    expect(res.status).toBe(200)

    const update = p.user.update.mock.calls.find((c: any) => c[0].data?.status === 'banned')[0]
    expect(update.where).toEqual({ id: 'bad' })
    expect(update.data.tokenVersion).toEqual({ increment: 1 })

    const upsert = p.blacklist.upsert.mock.calls[0][0]
    expect(upsert.where).toEqual({ email: 'bad@example.com' })
    expect(upsert.create).toMatchObject({ email: 'bad@example.com', phone: '+90555', name: 'Bad Actor', reason: 'spam', bannedBy: 'Admin' })

    expect(p.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'bad' } })
  })
})
