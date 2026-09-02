import { describe, it, expect, vi, beforeEach } from 'vitest'

// The directory-reports LIST was the one moderator-reachable admin queue left
// without a city scope (docs/multi-city-next-steps.md §4): its row route
// refused a cross-city action, but the list showed a Bodrum moderator every
// city's reports first. The list is now scoped the way the moderation queue
// is — through the reported business's city, failing closed for a moderator
// with no city — while an admin still sees everything.
//
// Written against the unfixed route first and seen to fail there.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { businessReport: { findMany: vi.fn().mockResolvedValue([]) } } }))

import { GET } from '@/app/api/admin/directory/reports/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const req = (qs = '') => ({ url: `http://x/app/api/admin/directory/reports${qs}` }) as any
const p = prisma as any
const whereOf = () => p.businessReport.findMany.mock.calls.at(-1)[0].where

beforeEach(() => vi.clearAllMocks())

describe('GET /api/admin/directory/reports — city scope', () => {
  it("a moderator's list is limited to businesses in their own city", async () => {
    ;(getSession as any).mockResolvedValue({ id: 'm1', role: 'moderator', cityId: 'c-bodrum' })
    expect((await GET(req('?status=pending'))).status).toBe(200)
    expect(whereOf()).toEqual({ status: 'pending', business: { cityId: 'c-bodrum' } })
  })

  it('a moderator with no city fails closed — a filter that matches no row', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'm2', role: 'moderator' })
    await GET(req())
    expect(whereOf().business).toEqual({ cityId: '__no_city__' })
  })

  it('an admin sees every city', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'a1', role: 'admin', cityId: 'c-istanbul' })
    await GET(req('?status=resolved'))
    expect(whereOf()).toEqual({ status: 'resolved' })
  })

  it('a member is refused before any query', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'u1', role: 'member', cityId: 'c-bodrum' })
    expect((await GET(req())).status).toBe(403)
    expect(p.businessReport.findMany).not.toHaveBeenCalled()
  })
})
