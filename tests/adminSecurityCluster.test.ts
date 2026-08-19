import { describe, it, expect, vi, beforeEach } from 'vitest'

// The security-cluster fixes (S2–S8). Each pins the arm that vanishes silently
// under a careless refactor because the response would still look normal.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',   () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/email',   () => ({ sendListingAlertEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/neighborhoodsDb', () => ({ getNeighborhoodsForCity: vi.fn(async () => []) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    business: { findUnique: vi.fn(), update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) },
    user:     { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    listing:  { createMany: vi.fn(async () => ({ count: 0 })) },
    auditLog: { findMany: vi.fn(async () => [
      { id: 'a1', action: 'account.self_delete', adminName: 'X', description: 'd', targetId: 't',
        createdAt: new Date(), meta: { name: 'Deleted Person', email: 'ghost@x.com', phone: '+900000' } },
    ]) },
    $queryRaw: vi.fn(async () => []),
  },
}))
vi.mock('./_lib', () => ({
  validateBusinessCreate: vi.fn(() => ({ data: {} })),
  validateFieldUpdate:    vi.fn(() => ({ data: {} })),
  dropUnchanged:          vi.fn((d: any) => d),
}), { virtual: true } as never)

import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const bodrumMod = { id: 'm1', name: 'Mod', role: 'moderator', cityId: 'c-bodrum' }
const admin     = { id: 'a1', name: 'Adm', role: 'admin',     cityId: 'c-ist' }
const IST = 'c-ist'
const req = (body: unknown = {}, url = 'https://x/api') =>
  new Request(url, { method: 'POST', body: JSON.stringify(body) }) as never
const getReq = (url = 'https://x/api') => new Request(url) as never

beforeEach(() => { vi.clearAllMocks() })

describe('S2 — directory parent route is city-gated', () => {
  it('moderator cannot PATCH another city’s business', async () => {
    ;(getSession as any).mockResolvedValue(bodrumMod)
    ;(prisma.business.findUnique as any).mockResolvedValue({ id: 'b1', name: 'B', cityId: IST })
    const { PATCH } = await import('@/app/api/admin/directory/route')
    const res = await PATCH(req({ id: 'b1', action: 'approve' }))
    expect(res.status).toBe(403)
    expect(prisma.business.update).not.toHaveBeenCalled()
  })
  it('moderator cannot DELETE another city’s business', async () => {
    ;(getSession as any).mockResolvedValue(bodrumMod)
    ;(prisma.business.findUnique as any).mockResolvedValue({ name: 'B', cityId: IST })
    const { DELETE } = await import('@/app/api/admin/directory/route')
    const res = await DELETE(req({ id: 'b1' }))
    expect(res.status).toBe(403)
    expect(prisma.business.delete).not.toHaveBeenCalled()
  })
})

describe('S4 — audit meta is stripped for non-admins', () => {
  it('moderator gets rows without meta (the PII carrier)', async () => {
    ;(getSession as any).mockResolvedValue(bodrumMod)
    const { GET } = await import('@/app/api/admin/audit/route')
    const rows = await (await GET(getReq('https://x/api/admin/audit'))).json()
    expect(rows[0].meta).toBeNull()
    expect(rows[0].action).toBe('account.self_delete')  // who/what/when survives
  })
  it('admin keeps meta', async () => {
    ;(getSession as any).mockResolvedValue(admin)
    const { GET } = await import('@/app/api/admin/audit/route')
    const rows = await (await GET(getReq('https://x/api/admin/audit'))).json()
    expect(rows[0].meta).toMatchObject({ email: 'ghost@x.com' })
  })
})

describe('S7 — bulk listings is admin-only', () => {
  it('rejects a moderator', async () => {
    ;(getSession as any).mockResolvedValue(bodrumMod)
    const { POST } = await import('@/app/api/admin/listings/bulk/route')
    const res = await POST(req({ category: 'ROOMS', items: [{ title: 'x' }] }))
    expect(res.status).toBe(403)
    expect(prisma.listing.createMany).not.toHaveBeenCalled()
  })
})
