import { describe, it, expect, vi, beforeEach } from 'vitest'

// Array-form $transaction accepts only Prisma calls: the real client checks
// every element's Symbol.toStringTag and throws "All elements of the array
// need to be Prisma Client promises" otherwise. The admin memberships route
// cast its ops `as never`, which let a claimOnce() (a plain async helper)
// into the reject path, and every admin rejection 500'd in production. The
// mock below applies the same check, so a plain Promise in any op list fails
// here the way it failed live.
// (defineProperty: Promise.prototype's toStringTag is read-only, so a plain
// assignment throws.)
const prismaPromise = <T>(value: T) =>
  Object.defineProperty(Promise.resolve(value), Symbol.toStringTag, { value: 'PrismaPromise' })

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/audit',     () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ claimOnce: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    club:           { findUnique: vi.fn(), update: vi.fn() },
    user:           { findUnique: vi.fn() },
    clubMembership: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction:   vi.fn(async (ops: unknown[]) => {
      if (!ops.every(op => (op as any)?.[Symbol.toStringTag] === 'PrismaPromise')) {
        throw new Error('All elements of the array need to be Prisma Client promises.')
      }
      return Promise.all(ops)
    }),
  },
}))

import { POST, PATCH, DELETE } from '@/app/api/admin/clubs/[id]/memberships/route'
import { getSession } from '@/lib/session'
import { claimOnce } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'

const params = { params: Promise.resolve({ id: 'c1' }) }
const req = (body: any = {}) => ({ json: async () => body }) as any
const p = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'a1', name: 'Admin', role: 'admin' })
  p.club.findUnique.mockResolvedValue({ name: 'Social' })
  p.user.findUnique.mockResolvedValue({ name: 'Ayşe' })
  p.club.update.mockImplementation(() => prismaPromise({ id: 'c1' }))
  p.clubMembership.create.mockImplementation(() => prismaPromise({ id: 'm1', user: { name: 'Ayşe' } }))
  p.clubMembership.update.mockImplementation(() => prismaPromise({ id: 'm1', status: 'approved' }))
  p.clubMembership.delete.mockImplementation(() => prismaPromise({ id: 'm1' }))
})

describe('PATCH /admin/clubs/[id]/memberships — reject', () => {
  it('deletes the row in a transaction of Prisma calls only, then starts the cooldown', async () => {
    p.clubMembership.findUnique.mockResolvedValue({ status: 'pending', role: 'member' })

    const res = await PATCH(req({ userId: 'u1', status: 'rejected' }), params)
    expect(res.status).toBe(200)
    expect(p.clubMembership.delete).toHaveBeenCalledWith({ where: { userId_clubId: { userId: 'u1', clubId: 'c1' } } })
    expect(claimOnce).toHaveBeenCalledWith('club-rejected:u1:c1', 7 * 24 * 60 * 60_000)
  })

  it('decrements memberCount when rejecting an approved member', async () => {
    p.clubMembership.findUnique.mockResolvedValue({ status: 'approved', role: 'member' })

    const res = await PATCH(req({ userId: 'u1', status: 'rejected' }), params)
    expect(res.status).toBe(200)
    expect(p.club.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { memberCount: { increment: -1 } } })
  })

  it('takes no cooldown claim when the transaction fails', async () => {
    p.clubMembership.findUnique.mockResolvedValue({ status: 'pending', role: 'member' })
    p.$transaction.mockRejectedValueOnce(new Error('db down'))

    const res = await PATCH(req({ userId: 'u1', status: 'rejected' }), params)
    expect(res.status).toBe(500)
    expect(claimOnce).not.toHaveBeenCalled()
  })
})

describe('PATCH /admin/clubs/[id]/memberships — approve / role', () => {
  it('approves a pending request without a cooldown claim', async () => {
    p.clubMembership.findUnique.mockResolvedValue({ status: 'pending', role: 'member' })

    const res = await PATCH(req({ userId: 'u1', status: 'approved' }), params)
    expect(res.status).toBe(200)
    expect(p.club.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { memberCount: { increment: 1 } } })
    expect(claimOnce).not.toHaveBeenCalled()
  })
})

describe('POST and DELETE /admin/clubs/[id]/memberships', () => {
  it('adds a member', async () => {
    const res = await POST(req({ userId: 'u1' }), params)
    expect(res.status).toBe(200)
  })

  it('removes an approved member', async () => {
    p.clubMembership.findUnique.mockResolvedValue({ status: 'approved', role: 'member' })
    const res = await DELETE(req({ userId: 'u1' }), params)
    expect(res.status).toBe(200)
  })
})
