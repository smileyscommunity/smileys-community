import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  auditLog:      { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
  user:          { findUnique: vi.fn() },
  event:         { findUnique: vi.fn() },
  club:          { findUnique: vi.fn() },
  business:      { findUnique: vi.fn() },
  listing:       { findUnique: vi.fn() },
  neighborhood:  { findUnique: vi.fn() },
  guideEntry:    { findUnique: vi.fn() },
  testimonial:   { findUnique: vi.fn() },
  post:          { findUnique: vi.fn() },
  payment:       { findUnique: vi.fn() },
  noShowCard:    { findUnique: vi.fn() },
  businessClaim: { findUnique: vi.fn() },
  report:        { findUnique: vi.fn() },
} }))

import { writeAudit } from '@/lib/audit'
import { GET } from '@/app/api/admin/audit/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

// "What happened in Bodrum" — the audit row now carries the target's city,
// resolved from the target rather than by 96 call sites, and the audit view
// scopes moderators to their city while keeping the city-less rows they
// could always read. Written against the unfixed code first: every case
// below failed there.

const p = prisma as any
const created = () => p.auditLog.create.mock.calls.at(-1)[0].data
const whereOf = () => p.auditLog.findMany.mock.calls.at(-1)[0].where

beforeEach(() => vi.clearAllMocks())

describe('writeAudit — city from the target', () => {
  it("a user's home city", async () => {
    p.user.findUnique.mockResolvedValue({ cityId: 'c-bodrum' })
    await writeAudit('a', 'Admin', 'user.suspend', 'u1', 'user')
    expect(created()).toMatchObject({ targetId: 'u1', targetType: 'user', cityId: 'c-bodrum' })
  })
  it("an event's city; a card and a payment through their event", async () => {
    p.event.findUnique.mockResolvedValue({ cityId: 'c-izmir' })
    await writeAudit('a', 'Admin', 'event.delete', 'e1', 'event')
    expect(created().cityId).toBe('c-izmir')
    p.noShowCard.findUnique.mockResolvedValue({ event: { cityId: 'c-antalya' } })
    await writeAudit('h', 'Host', 'no_show.waive', 'n1', 'no_show_card')
    expect(created().cityId).toBe('c-antalya')
    p.payment.findUnique.mockResolvedValue({ event: null })
    await writeAudit('a', 'Admin', 'payment.refund', 'p1', 'payment')
    expect(created().cityId).toBeNull()
  })
  it('the city itself is its own city', async () => {
    await writeAudit('a', 'Admin', 'city.go_live', 'c-bodrum', 'city')
    expect(created().cityId).toBe('c-bodrum')
  })
  it('a caller that knows the city wins over the lookup', async () => {
    await writeAudit('a', 'Admin', 'broadcast.send', 'b1', 'broadcast', { cityId: 'c-izmir', count: 40 })
    expect(created().cityId).toBe('c-izmir')
    expect(p.user.findUnique).not.toHaveBeenCalled()
  })
  it('a city-less or unknown target audits as null, and a failed lookup never blocks the write', async () => {
    await writeAudit('a', 'Admin', 'setting.update', 'announcement', 'setting')
    expect(created().cityId).toBeNull()
    p.club.findUnique.mockRejectedValue(new Error('db down'))
    await writeAudit('a', 'Admin', 'club.archive', 'k1', 'club')
    expect(created()).toMatchObject({ action: 'club.archive', cityId: null })
  })
})

describe('GET /api/admin/audit — city scope', () => {
  const req = (qs = '') => ({ url: `http://x/app/api/admin/audit${qs}` }) as any

  it("a moderator sees their own city's rows and the city-less ones", async () => {
    ;(getSession as any).mockResolvedValue({ id: 'm1', role: 'moderator', cityId: 'c-bodrum' })
    expect((await GET(req())).status).toBe(200)
    expect(whereOf().OR).toEqual([{ cityId: 'c-bodrum' }, { cityId: null }])
  })
  it('a moderator with no city fails closed on the city arm', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'm2', role: 'moderator' })
    await GET(req())
    expect(whereOf().OR).toEqual([{ cityId: '__no_city__' }, { cityId: null }])
  })
  it('the city scope and a text search are ANDed, not one replacing the other', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'm1', role: 'moderator', cityId: 'c-bodrum' })
    await GET(req('?search=ban'))
    const w = whereOf()
    expect(w.OR).toBeUndefined()
    expect(w.AND[0]).toEqual({ OR: [{ cityId: 'c-bodrum' }, { cityId: null }] })
    expect(w.AND[1].OR).toHaveLength(3)
  })
  it('an admin sees everything by default and can narrow to one city', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'a1', role: 'admin', cityId: 'c-istanbul' })
    await GET(req())
    expect(whereOf().OR).toBeUndefined(); expect(whereOf().cityId).toBeUndefined()
    await GET(req('?city=c-izmir'))
    expect(whereOf().cityId).toBe('c-izmir')
  })
})
