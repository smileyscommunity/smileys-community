import { describe, it, expect, vi, beforeEach } from 'vitest'

// docs/admin-panel-audit-2026-09-05.md finding 2: requireStepUp existed but
// guarded two routes. These pin the ones added on 2026-09-05 — club deletion
// and the newsletter's real send — and, just as deliberately, what stays
// open: the newsletter's preview/test sends only reach the admin's own inbox.
// Each 403 case was run against the unguarded route first and failed there.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',   () => ({ writeAudit: vi.fn(async () => {}), getDiff: vi.fn(() => ({})) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/survey',  () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()), aggregateRollup: vi.fn(() => null) }))
vi.mock('@/lib/newsletterDigest', () => ({ buildWeeklyDigest: vi.fn(async () => null) }))
vi.mock('@/lib/email',   () => ({
  sendNewsletterEmail: vi.fn(async () => {}),
  sendNewsletterBatch: vi.fn(async () => ({ sent: 0, resendLogs: [], failed: [] })),
  recordEmailFailure:  vi.fn(async () => {}),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    club:       { findUnique: vi.fn(async () => ({ name: 'C', cityId: 'c-ist' })), delete: vi.fn(async () => ({})) },
    user:       { findUnique: vi.fn(async () => ({ email: 'a@x', name: 'A' })), findMany: vi.fn(async () => [{ id: 'u1', email: 'u@x', name: 'U' }]) },
    city:       { findUnique: vi.fn(async () => null) },
    newsletter: { create: vi.fn(async () => ({ id: 'n1' })), update: vi.fn(async () => ({})) },
    appSetting: { findUnique: vi.fn(async () => null) },
  },
}))

import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { sendNewsletterEmail } from '@/lib/email'
import { DELETE as clubDELETE } from '@/app/api/admin/clubs/[id]/route'
import { POST as newsletterPOST } from '@/app/api/admin/newsletter/route'

const verified = { id: 'a1', name: 'A', email: 'a@x', role: 'admin', color: '#000', totpVerified: true }
const stale    = { id: 'a1', name: 'A', email: 'a@x', role: 'admin', color: '#000' }

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const send = (body: Record<string, unknown>) => newsletterPOST(new Request('https://x/app/api/admin/newsletter', {
  method: 'POST', body: JSON.stringify({ subject: 'S', bodyHtml: '<p>hi</p>', segment: 'all', ...body }),
}) as never)

beforeEach(() => vi.clearAllMocks())

describe('club DELETE', () => {
  it('refuses an admin session that never passed TOTP, before touching the row', async () => {
    ;(getSession as any).mockResolvedValue(stale)
    const res = await clubDELETE(new Request('https://x') as never, params('cl1'))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('totp_required')
    expect(prisma.club.delete).not.toHaveBeenCalled()
  })

  it('deletes for a TOTP-verified admin', async () => {
    ;(getSession as any).mockResolvedValue(verified)
    const res = await clubDELETE(new Request('https://x') as never, params('cl1'))
    expect(res.status).toBe(200)
    expect(prisma.club.delete).toHaveBeenCalledWith({ where: { id: 'cl1' } })
  })
})

describe('newsletter POST', () => {
  it('the real send steps up — no Newsletter row, no fan-out', async () => {
    ;(getSession as any).mockResolvedValue(stale)
    const res = await send({})
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('totp_required')
    expect(prisma.newsletter.create).not.toHaveBeenCalled()
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('a scheduled send steps up too — the sweeper would fire it later regardless', async () => {
    ;(getSession as any).mockResolvedValue(stale)
    const res = await send({ scheduledFor: new Date(Date.now() + 3_600_000).toISOString() })
    expect(res.status).toBe(403)
    expect(prisma.newsletter.create).not.toHaveBeenCalled()
  })

  it('the test send to your own inbox does not step up', async () => {
    ;(getSession as any).mockResolvedValue(stale)
    const res = await send({ test: true })
    expect(res.status).toBe(200)
    expect(sendNewsletterEmail).toHaveBeenCalledTimes(1)
    expect((sendNewsletterEmail as any).mock.calls[0][1]).toBe('a@x')
  })

  it('a TOTP-verified admin sends', async () => {
    ;(getSession as any).mockResolvedValue(verified)
    const res = await send({})
    expect(res.status).toBe(200)
    expect(prisma.newsletter.create).toHaveBeenCalledTimes(1)
  })
})
