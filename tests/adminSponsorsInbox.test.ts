import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = {
  findMany: vi.fn(), groupBy: vi.fn(), findUnique: vi.fn(), update: vi.fn(), del: vi.fn(),
}
vi.mock('@/lib/session', () => ({ getSession: async () => ({ id: 'a1', name: 'Admin', role: 'admin' }) }))
vi.mock('@/lib/access', () => ({ isAdmin: () => true }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sponsorLead: {
  findMany: (a: unknown) => m.findMany(a), groupBy: (a: unknown) => m.groupBy(a),
  findUnique: (a: unknown) => m.findUnique(a), update: (a: unknown) => m.update(a), delete: (a: unknown) => m.del(a),
} } }))

import { NextRequest } from 'next/server'
import { GET, PATCH, DELETE } from '@/app/api/admin/sponsors/route'
const req = (url: string, init?: RequestInit) => new NextRequest(`http://x${url}`, init as never)
const lead = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, email: `a${i}@x.com`, company: 'C', status: 'new', currency: 'TRY' }))

beforeEach(() => { Object.values(m).forEach(f => f.mockReset()); m.groupBy.mockResolvedValue([]) })

describe('GET /api/admin/sponsors', () => {
  it('pages: returns 50 and a cursor when there are more', async () => {
    m.findMany.mockResolvedValue(lead(51))
    const body = await (await GET(req('/api/admin/sponsors'))).json()
    expect(body.leads).toHaveLength(50)
    expect(body.nextCursor).toBe('l49')
    expect(m.findMany.mock.calls[0][0].take).toBe(51)
  })
  it('filters server-side: kind, status, archived and search', async () => {
    m.findMany.mockResolvedValue([])
    await GET(req('/api/admin/sponsors?kind=partnerships&status=won&archived=1&q=acme&cursor=l9'))
    const a = m.findMany.mock.calls[0][0]
    expect(a.where.archivedAt).toEqual({ not: null })
    expect(a.where.AND[0]).toEqual({ source: 'partners' })
    expect(a.where.status).toBe('won')
    expect(a.where.OR).toHaveLength(5)
    expect(a.cursor).toEqual({ id: 'l9' })
  })
  it('sponsor kind keeps NULL-source rows', async () => {
    m.findMany.mockResolvedValue([])
    await GET(req('/api/admin/sponsors?kind=sponsors'))
    expect(m.findMany.mock.calls[0][0].where.AND[0]).toEqual({ OR: [{ source: null }, { source: { not: 'partners' } }] })
  })
  it('ignores an unknown status', async () => {
    m.findMany.mockResolvedValue([])
    await GET(req('/api/admin/sponsors?status=bogus'))
    expect(m.findMany.mock.calls[0][0].where.status).toBeUndefined()
  })
})

describe('archive and delete', () => {
  it('PATCH archived:true stamps archivedAt; false clears it; non-boolean is rejected', async () => {
    m.findUnique.mockResolvedValue({ id: 'l1', company: 'C', status: 'new', dealValue: null })
    m.update.mockResolvedValue({ id: 'l1' })
    const patch = (b: object) => PATCH(req('/api/admin/sponsors', { method: 'PATCH', body: JSON.stringify({ id: 'l1', ...b }) }))
    expect((await patch({ archived: true })).status).toBe(200)
    expect(m.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date)
    await patch({ archived: false })
    expect(m.update.mock.calls[1][0].data.archivedAt).toBeNull()
    expect((await patch({ archived: 'yes' })).status).toBe(400)
  })
  it('DELETE removes a lead but refuses a won deal', async () => {
    m.findUnique.mockResolvedValueOnce({ company: 'C', status: 'lost' })
    expect((await DELETE(req('/api/admin/sponsors?id=l1', { method: 'DELETE' }))).status).toBe(200)
    expect(m.del).toHaveBeenCalledTimes(1)
    m.findUnique.mockResolvedValueOnce({ company: 'C', status: 'won' })
    expect((await DELETE(req('/api/admin/sponsors?id=l2', { method: 'DELETE' }))).status).toBe(409)
    expect(m.del).toHaveBeenCalledTimes(1)
  })
})
