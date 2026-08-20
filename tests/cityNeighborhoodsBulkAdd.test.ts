import { describe, it, expect, vi, beforeEach } from 'vitest'

// The bulk-add route replaces the last developer-run step in a city launch
// (a hand-written seed script for neighborhoods — the go-live gate's hard
// blocker). These pin what makes it safe to hand to admins:
//  - names normalize + dedupe BY SLUG within a batch ("Kadıköy" vs "kadikoy ")
//  - re-pasting a grown list adds exactly the new rows (idempotent)
//  - a moderator can't seed another city's neighborhoods
//  - a bad body / empty paste never writes

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',   () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    city:         { findUnique: vi.fn(async () => ({ id: 'c-izm', name: 'Izmir' })) },
    neighborhood: { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(), count: vi.fn(async () => 0) },
  },
}))

import { POST } from '@/app/api/admin/cities/[id]/neighborhoods/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const admin = { id: 'a1', name: 'A', role: 'admin', cityId: 'c-ist' }
const mod   = { id: 'm1', name: 'M', role: 'moderator', cityId: 'c-ist' }
const params = { params: Promise.resolve({ id: 'c-izm' }) } as never
const post = (body: unknown) =>
  POST(new Request('https://x/api', { method: 'POST', body: JSON.stringify(body) }) as never, params)

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(admin)
  ;(prisma.neighborhood.findMany as any).mockResolvedValue([])
})

describe('city neighborhoods bulk-add', () => {
  it('normalizes, slug-dedupes within the batch, and creates rows with derived slugs', async () => {
    const res = await post({ names: ['  Alsancak ', 'Karşıyaka', 'karsiyaka', '', 'Bornova\t'] })
    expect(res.status).toBe(201)
    const rows = (prisma.neighborhood.createMany as any).mock.calls[0][0].data
    // karsiyaka folded into Karşıyaka by slug; empty dropped; whitespace trimmed
    expect(rows.map((r: any) => r.name)).toEqual(['Alsancak', 'Karşıyaka', 'Bornova'])
    expect(rows.every((r: any) => r.cityId === 'c-izm' && r.slug)).toBe(true)
  })

  it('re-pasting a grown list adds exactly the new names', async () => {
    ;(prisma.neighborhood.findMany as any).mockResolvedValue([
      { id: 'n0', slug: 'alsancak', name: 'Alsancak', sortOrder: 1, active: true },
    ])
    const res = await post({ names: ['Alsancak', 'Bornova'] })
    const body = await res.json()
    expect(body.added).toBe(1)
    expect(body.skipped).toBe(1)
    const rows = (prisma.neighborhood.createMany as any).mock.calls[0][0].data
    expect(rows.map((r: any) => r.name)).toEqual(['Bornova'])
    // sortOrder continues after the existing max
    expect(rows[0].sortOrder).toBe(2)
  })

  it('a moderator cannot seed another city', async () => {
    ;(getSession as any).mockResolvedValue(mod)
    const res = await post({ names: ['Alsancak'] })
    expect(res.status).toBe(403)
    expect(prisma.neighborhood.createMany).not.toHaveBeenCalled()
  })

  it('empty / invalid input never writes', async () => {
    expect((await post({ names: [] })).status).toBe(400)
    expect((await post({ names: ['   ', ''] })).status).toBe(400)
    expect((await post({ nope: true })).status).toBe(400)
    expect(prisma.neighborhood.createMany).not.toHaveBeenCalled()
  })

  it('caps the batch at 100', async () => {
    const res = await post({ names: Array.from({ length: 101 }, (_, i) => `Hood ${i}`) })
    expect(res.status).toBe(400)
    expect(prisma.neighborhood.createMany).not.toHaveBeenCalled()
  })

  it('re-pasting a soft-deleted name RE-ACTIVATES it instead of skipping', async () => {
    ;(prisma.neighborhood.findMany as any).mockResolvedValueOnce([
      { id: 'n1', slug: 'foo', name: 'Foo', sortOrder: 1, active: false },
    ])
    const res = await post({ names: ['Foo'] })
    const body = await res.json()
    // Not created (slug exists), not skipped (it was hidden) — reactivated.
    expect(body.reactivated).toBe(1)
    expect(body.added).toBe(0)
    expect((prisma.neighborhood.updateMany as any).mock.calls[0][0]).toMatchObject({
      data: { active: true },
    })
  })
})