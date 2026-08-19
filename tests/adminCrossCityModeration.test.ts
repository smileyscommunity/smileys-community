import { describe, it, expect, vi, beforeEach } from 'vitest'

// The 2026-08-19 route sweep: every admin [id] route whose LIST view is
// city-scoped for moderators, but whose row route accepted any id. The list
// filter looked like authorization and wasn't — a moderator with a row id
// (leaked, guessed, or remembered from before a transfer) could read PII or
// mutate another city's data. Each route now fetches the row's city and
// applies canActInCity before acting.
//
// These pin the 403 arm for a Bodrum moderator touching an Istanbul row —
// the arm that silently vanishes if someone refactors the fetch and drops
// the gate, because the response would still look perfectly normal.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',   () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: vi.fn() } } } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    memberApplication: { findUnique: vi.fn() },
    report:            { findUnique: vi.fn() },
    event:             { findUnique: vi.fn(), create: vi.fn() },
    listing:           { findUnique: vi.fn(), update: vi.fn() },
    businessClaim:     { findUnique: vi.fn() },
    businessReport:    { findUnique: vi.fn(), update: vi.fn() },
    businessReview:    { findUnique: vi.fn(), update: vi.fn() },
  },
}))

import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const bodrumMod = { id: 'm1', name: 'Mod', role: 'moderator', cityId: 'c-bodrum' }
const IST = 'c-ist'
const params = { params: Promise.resolve({ id: 'row1', slug: 'x' }) } as never
const req = (body: unknown = {}) =>
  new Request('https://x/api', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(bodrumMod)
})

describe('moderator cannot act on another city through [id] routes', () => {
  it('applications/screen refuses before reading the application into a prompt', async () => {
    ;(prisma.memberApplication.findUnique as any).mockResolvedValue({ fullName: 'X', targetCityId: IST })
    const { POST } = await import('@/app/api/admin/applications/screen/route')
    expect((await POST(req({ id: 'row1' }))).status).toBe(403)
  })

  it('applications/welcome — same gate', async () => {
    ;(prisma.memberApplication.findUnique as any).mockResolvedValue({ fullName: 'X', targetCityId: IST })
    const { POST } = await import('@/app/api/admin/applications/welcome/route')
    expect((await POST(req({ id: 'row1' }))).status).toBe(403)
  })

  it('moderation/triage refuses a report about another city’s member', async () => {
    ;(prisma.report.findUnique as any).mockResolvedValue({
      id: 'row1', reporter: { name: 'A' },
      reported: { name: 'B', status: 'approved', warningCount: 0, joinedAt: new Date(), cityId: IST, _count: { reportsReceived: 1 } },
    })
    const { POST } = await import('@/app/api/admin/moderation/triage/route')
    expect((await POST(req({ reportId: 'row1' }))).status).toBe(403)
  })

  it('events/[id]/duplicate refuses — the copy would be a cross-city create', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue({ id: 'row1', cityId: IST, title: 'T' })
    const { POST } = await import('@/app/api/admin/events/[id]/duplicate/route')
    expect((await POST(req(), params)).status).toBe(403)
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it('listings/[id] refuses on all three methods', async () => {
    ;(prisma.listing.findUnique as any).mockResolvedValue({ id: 'row1', cityId: IST, title: 'T', userId: 'u', status: 'active', category: 'ROOMS' })
    const { GET, PATCH, DELETE } = await import('@/app/api/admin/listings/[id]/route')
    expect((await GET(req(), params)).status).toBe(403)
    expect((await DELETE(req(), params)).status).toBe(403)
    expect((await PATCH(req({ status: 'deleted' }), params)).status).toBe(403)
    expect(prisma.listing.update).not.toHaveBeenCalled()
  })

  it('directory claim/report/review moderation refuses across cities', async () => {
    ;(prisma.businessClaim.findUnique as any).mockResolvedValue({
      id: 'row1', claimantId: 'u', business: { id: 'b', name: 'B', claimedById: null, cityId: IST },
    })
    ;(prisma.businessReport.findUnique as any).mockResolvedValue({
      id: 'row1', businessId: 'b', reason: 'spam', business: { cityId: IST },
    })
    ;(prisma.businessReview.findUnique as any).mockResolvedValue({
      id: 'row1', businessId: 'b', business: { cityId: IST },
    })
    const claims  = await import('@/app/api/admin/directory/claims/[id]/route')
    const reports = await import('@/app/api/admin/directory/reports/[id]/route')
    const reviews = await import('@/app/api/admin/directory/reviews/[id]/route')
    expect((await claims.PATCH(req({ action: 'approve' }), params)).status).toBe(403)
    expect((await reports.PATCH(req({ action: 'resolve' }), params)).status).toBe(403)
    expect((await reviews.PATCH(req({ hide: true }), params)).status).toBe(403)
    expect(prisma.businessReport.update).not.toHaveBeenCalled()
    expect(prisma.businessReview.update).not.toHaveBeenCalled()
  })

  it('a moderator acting in their OWN city still passes the new gates', async () => {
    ;(prisma.listing.findUnique as any).mockResolvedValue({ id: 'row1', cityId: 'c-bodrum', title: 'T', userId: 'u', status: 'active', category: 'ROOMS' })
    const { GET } = await import('@/app/api/admin/listings/[id]/route')
    expect((await GET(req(), params)).status).toBe(200)
  })
})
