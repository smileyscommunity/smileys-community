import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 81–83 and the cup half of 85: a sponsor edit that couldn't
// clear its logo/website/blurb, "by date" cup headers a day early west of
// Istanbul, a tied rank hiding your own leaderboard row, a donation that
// could be published twice, and live-campaign sponsor/prize deletes open to
// moderators with no step-up.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => {
  const m: Record<string, any> = {
    cupSponsor: {
      findUnique: vi.fn(), findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 's-new', name: 'S', slug: 's', status: 'active' })),
      update: vi.fn(async ({ where }: any) => ({ id: where.id, name: 'S' })),
      delete: vi.fn(async () => ({})),
    },
    cupPrize: {
      findUnique: vi.fn(), findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'p-new' })),
      update: vi.fn(async ({ where }: any) => ({ id: where.id, title: 'P' })),
      delete: vi.fn(async () => ({})),
    },
    cupPrizeDonation: {
      findFirst: vi.fn(async () => ({ id: 'd1', status: 'pending', donorName: 'Donor', prizeTitle: 'Dinner' })),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
  }
  m.$transaction = vi.fn(async (fn: any) => fn(m))
  return m
})
const h = vi.hoisted(() => ({ session: { current: null as Record<string, unknown> | null } }))
const stepUp = vi.hoisted(() => ({ requireStepUp: vi.fn((): unknown => null) }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => h.session.current) }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/stepUp', () => stepUp)
vi.mock('@/lib/rateLimit', () => ({ claimOnce: vi.fn(async () => true), releaseClaim: vi.fn(async () => {}) }))

import { PATCH as sponsorPATCH, DELETE as sponsorDELETE } from '@/app/api/admin/cup/sponsors/route'
import { PATCH as prizePATCH, DELETE as prizeDELETE } from '@/app/api/admin/cup/prizes/route'
import { PATCH as donationPATCH } from '@/app/api/admin/campaigns/[id]/donations/route'
import { convertDonationToPrize, DonationAlreadyPublishedError } from '@/lib/cup-prize-conversion'
import { isLiveCampaign, LIVE_CUP_SLUG } from '@/lib/cup-data'
import { formatDay } from '@/lib/cityTime'

const admin = { id: 'a1', name: 'Admin', role: 'admin',     cityId: 'c-ist', totpVerified: true }
const mod   = { id: 'm1', name: 'Mod',   role: 'moderator', cityId: 'c-ist' }

const req = (body: unknown) =>
  new Request('https://x/app/api', { method: 'POST', body: JSON.stringify(body) }) as never
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  stepUp.requireStepUp.mockImplementation(() => null)
  p.cupPrizeDonation.updateMany.mockImplementation(async () => ({ count: 1 }))
  h.session.current = admin
})

describe('81 sponsor edit clears emptied fields', () => {
  beforeEach(() => { p.cupSponsor.findUnique.mockResolvedValue({ id: 's1', name: 'S' }) })

  it('stores null for a field sent as null or blank, and leaves an omitted field alone', async () => {
    const res = await sponsorPATCH(req({ id: 's1', name: 'S', logoUrl: null, websiteUrl: '', blurb: '   ' }))
    expect(res.status).toBe(200)
    const data = p.cupSponsor.update.mock.calls[0][0].data
    expect(data).toMatchObject({ logoUrl: null, websiteUrl: null, blurb: null })
    expect('instagramUrl' in data).toBe(false)
  })

  it('still writes a new value, and still refuses an unsafe URL', async () => {
    await sponsorPATCH(req({ id: 's1', websiteUrl: 'https://example.com' }))
    expect(p.cupSponsor.update.mock.calls[0][0].data).toEqual({ websiteUrl: 'https://example.com' })
    const bad = await sponsorPATCH(req({ id: 's1', logoUrl: 'javascript:alert(1)' }))
    expect(bad.status).toBe(400)
  })

  it('the edit form sends null for an emptied field (so the route can clear it)', () => {
    const src = read('components/admin/CampaignBoardPanel.tsx')
    expect(src).toMatch(/logoUrl:\s+form\.logoUrl\.trim\(\)\s+\|\| null/)
    expect(src).toMatch(/websiteUrl:\s+form\.websiteUrl\.trim\(\)\s+\|\| null/)
    expect(src).toMatch(/blurb:\s+form\.blurb\.trim\(\)\s+\|\| null/)
  })

  it('prize PATCH keeps its omitted-vs-cleared rule', async () => {
    p.cupPrize.findUnique.mockResolvedValue({ id: 'p1' })
    await prizePATCH(req({ id: 'p1', imageUrl: '' }))
    const data = p.cupPrize.update.mock.calls[0][0].data
    expect(data.imageUrl).toBeNull()
    expect('description' in data).toBe(false)
  })
})

describe('82 cup day headers are calendar days', () => {
  it('formatDay renders the key as that day in any zone', () => {
    expect(formatDay('2026-06-11', { weekday: 'short', day: 'numeric', month: 'short' })).toBe('Thu 11 Jun')
  })

  it('the page formats the day key, not Istanbul midnight in the viewer zone', () => {
    const src = read('app/(member)/cup/page.tsx')
    expect(src).toMatch(/const dayLabel = formatDay\(d\.dayKey, /)
    expect(src).not.toMatch(/fromWallClockInTz\(`\$\{key\}T00:00`/)
    expect(src).not.toMatch(/d\.date\.toLocaleDateString/)
  })
})

describe('83 your leaderboard row is found by identity', () => {
  it('both boards look for isYou, never for a row sharing your rank', () => {
    const src = read('app/(member)/cup/page.tsx')
    expect(src).toMatch(/const idx = data\.rows\.findIndex\(r => r\.isYou\)/)
    expect(src).toMatch(/const youInSlice = data\.rows\.some\(r => r\.isYou\)/)
    expect(src).not.toMatch(/r\.rank === yourRank/)
    expect(src).not.toMatch(/r\.rank === data\.yourRank/)
  })
})

describe('85a donation publish is once-only', () => {
  const args = {
    donationId: 'd1', campaignId: 'c1', reviewedByUserId: 'a1', reviewNote: null,
    sponsor: { name: 'Mikla' }, prize: { title: 'Dinner for two' },
  }
  // No slug conflict (an earlier block left a sponsor row mocked).
  beforeEach(() => { p.cupSponsor.findUnique.mockResolvedValue(null) })

  it('claims the unpublished donation before creating anything', async () => {
    const out = await convertDonationToPrize(p as never, args)
    expect(out).toEqual({ sponsorId: 's-new', prizeId: 'p-new' })
    expect(p.cupPrizeDonation.updateMany.mock.calls[0][0].where).toEqual({ id: 'd1', linkedPrizeId: null })
    const claimOrder = p.cupPrizeDonation.updateMany.mock.invocationCallOrder[0]
    expect(claimOrder).toBeLessThan(p.cupSponsor.create.mock.invocationCallOrder[0])
    expect(p.cupPrizeDonation.update.mock.calls[0][0].data).toEqual({ linkedSponsorId: 's-new', linkedPrizeId: 'p-new' })
  })

  it('the loser throws and creates no sponsor or prize', async () => {
    p.cupPrizeDonation.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(convertDonationToPrize(p as never, args)).rejects.toBeInstanceOf(DonationAlreadyPublishedError)
    expect(p.cupSponsor.create).not.toHaveBeenCalled()
    expect(p.cupPrize.create).not.toHaveBeenCalled()
  })

  it('the route answers 409 to the second publish', async () => {
    p.cupPrizeDonation.updateMany.mockResolvedValueOnce({ count: 0 })
    const res = await donationPATCH(req({ id: 'd1', action: 'approve', prize: { title: 'Dinner' } }), params('c1'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already been published/)
  })

  it('the first publish still succeeds', async () => {
    const res = await donationPATCH(req({ id: 'd1', action: 'approve', prize: { title: 'Dinner' } }), params('c1'))
    expect(res.status).toBe(200)
    expect((await res.json()).prizeId).toBe('p-new')
  })
})

describe('85b live-campaign sponsor/prize deletes', () => {
  it('isLiveCampaign: running and orphaned rows are live, finished ones are not', () => {
    expect(isLiveCampaign({ slug: 'summer', status: 'active' })).toBe(true)
    expect(isLiveCampaign({ slug: LIVE_CUP_SLUG, status: 'archived' })).toBe(true)
    expect(isLiveCampaign(null)).toBe(true)
    for (const status of ['draft', 'wrapped', 'archived']) {
      expect(isLiveCampaign({ slug: 'summer', status })).toBe(false)
    }
  })

  const cases = [
    { name: 'sponsor', model: 'cupSponsor', DELETE: sponsorDELETE, row: { name: 'S' } },
    { name: 'prize',   model: 'cupPrize',   DELETE: prizeDELETE,   row: { title: 'P' } },
  ] as const

  for (const c of cases) {
    describe(c.name, () => {
      it('a moderator cannot delete on a live campaign', async () => {
        h.session.current = mod
        p[c.model].findUnique.mockResolvedValue({ ...c.row, campaign: { slug: 'summer', status: 'active' } })
        const res = await c.DELETE(req({ id: 'x1' }))
        expect(res.status).toBe(403)
        expect(p[c.model].delete).not.toHaveBeenCalled()
      })

      it('a moderator cannot delete an orphaned (campaign-less) row', async () => {
        h.session.current = mod
        p[c.model].findUnique.mockResolvedValue({ ...c.row, campaign: null })
        expect((await c.DELETE(req({ id: 'x1' }))).status).toBe(403)
        expect(p[c.model].delete).not.toHaveBeenCalled()
      })

      it('a moderator can still delete on an archived campaign, without step-up', async () => {
        h.session.current = mod
        p[c.model].findUnique.mockResolvedValue({ ...c.row, campaign: { slug: 'summer', status: 'archived' } })
        expect((await c.DELETE(req({ id: 'x1' }))).status).toBe(200)
        expect(p[c.model].delete).toHaveBeenCalled()
        expect(stepUp.requireStepUp).not.toHaveBeenCalled()
      })

      it('an admin on a live campaign goes through step-up', async () => {
        p[c.model].findUnique.mockResolvedValue({ ...c.row, campaign: { slug: 'summer', status: 'active' } })
        stepUp.requireStepUp.mockImplementationOnce(() => new Response(JSON.stringify({ code: 'totp_required' }), { status: 403 }))
        expect((await c.DELETE(req({ id: 'x1' }))).status).toBe(403)
        expect(p[c.model].delete).not.toHaveBeenCalled()

        expect((await c.DELETE(req({ id: 'x1' }))).status).toBe(200)
        expect(p[c.model].delete).toHaveBeenCalledTimes(1)
        expect(stepUp.requireStepUp).toHaveBeenCalledTimes(2)
      })
    })
  }

  it('the board panel shows the server reason when a delete is refused', () => {
    const src = read('components/admin/CampaignBoardPanel.tsx')
    expect(src.match(/toast\.error\(d\.error \?\? 'Delete failed'\)/g)?.length).toBe(2)
  })
})
