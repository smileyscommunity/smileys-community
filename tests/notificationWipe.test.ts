import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  notification: { deleteMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
} }))

import { NextRequest } from 'next/server'
import { DELETE } from '@/app/api/notifications/route'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'

// Clearing the bell is a hard delete, so the only thing standing between one
// member and another member's notifications is the userId in the WHERE.

const p = prisma as any
const del = (qs = '', body?: unknown) =>
  new NextRequest(`https://x.test/app/api/notifications${qs}`, {
    method: 'DELETE',
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', name: 'U', role: 'member' })
  ;(rateLimit as any).mockResolvedValue(true)
  p.notification.deleteMany.mockResolvedValue({ count: 1 })
})

describe('DELETE /api/notifications', () => {
  it('refuses a logged-out caller and deletes nothing', async () => {
    ;(getSession as any).mockResolvedValue(null)
    const res = await DELETE(del('?clearAll=true'))
    expect(res.status).toBe(401)
    expect(p.notification.deleteMany).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('clearAll wipes only the caller’s rows', async () => {
    const res = await DELETE(del('?clearAll=true'))
    expect(res.status).toBe(200)
    expect(p.notification.deleteMany).toHaveBeenCalledTimes(1)
    expect(p.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })

  it('a single delete is scoped to the caller even for someone else’s notification id', async () => {
    const res = await DELETE(del('', { id: 'n-of-u2', userId: 'u2' }))
    expect(res.status).toBe(200)
    expect(p.notification.deleteMany).toHaveBeenCalledWith({ where: { id: 'n-of-u2', userId: 'u1' } })
  })

  it('no id and no clearAll → nothing is deleted (never an unscoped wipe)', async () => {
    const res = await DELETE(del('', {}))
    expect(res.status).toBe(200)
    expect(p.notification.deleteMany).not.toHaveBeenCalled()
  })

  it('clearAll other than the literal "true" falls through to the id path', async () => {
    const res = await DELETE(del('?clearAll=1', {}))
    expect(res.status).toBe(200)
    expect(p.notification.deleteMany).not.toHaveBeenCalled()
  })

  it('rate-limited on a per-user key → 429 and nothing deleted', async () => {
    ;(rateLimit as any).mockResolvedValue(false)
    const res = await DELETE(del('?clearAll=true'))
    expect(res.status).toBe(429)
    expect(rateLimit).toHaveBeenCalledWith('notif-delete:u1', 60, 60_000)
    expect(p.notification.deleteMany).not.toHaveBeenCalled()
  })
})
