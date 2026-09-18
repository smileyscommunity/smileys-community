import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Review fixes, 2026-09-19 — newsletter scheduling/counts/idempotency and the
// payments refund note + server-side filters.

const h = vi.hoisted(() => {
  // A tiny rate_limits table behind claimOnce: the first claim of a key
  // counts 1, a second one 2 (refused), releaseClaim deletes the row.
  const claims = new Map<string, number>()
  const prisma = {
    $queryRaw: vi.fn(async (_s: TemplateStringsArray, key: string) => {
      const n = (claims.get(key) ?? 0) + 1
      claims.set(key, n)
      return [{ count: n }]
    }),
    rateLimit:  { deleteMany: vi.fn(async ({ where: { key } }: any) => { claims.delete(key); return { count: 1 } }) },
    city:       { findUnique: vi.fn() },
    user:       { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    newsletter: { findMany: vi.fn(async () => []), create: vi.fn(), update: vi.fn(async () => ({})), deleteMany: vi.fn() },
    newsletterEmailLog: { createMany: vi.fn() },
    appSetting: { findUnique: vi.fn(async () => null) },
    payment:    { findUnique: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn(), count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
    paymentLog: { create: vi.fn() },
    event:      { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  }
  return { prisma, claims }
})

vi.mock('@/lib/prisma',  () => ({ prisma: h.prisma }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/stepUp',  () => ({ requireStepUp: vi.fn(() => null) }))
vi.mock('@/lib/audit',   () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/newsletterDigest', () => ({ buildWeeklyDigest: vi.fn(async () => null) }))
vi.mock('@/lib/city',    () => ({ resolveCityId: vi.fn(async () => 'c-ist'), getCityTz: vi.fn(async () => 'Europe/Istanbul') }))
vi.mock('@/lib/email',   () => ({
  sendNewsletterEmail: vi.fn(async () => {}),
  sendNewsletterBatch: vi.fn(async (recipients: unknown[]) => ({ sent: recipients.length, resendLogs: [], failed: [] })),
  recordEmailFailure:  vi.fn(async () => {}),
  sendRefundEmail:     vi.fn(async () => {}),
}))

import { getSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { sendNewsletterBatch, sendRefundEmail } from '@/lib/email'
import { GET as newsletterGET, POST as newsletterPOST } from '@/app/api/admin/newsletter/route'
import { GET as paymentsGET, PATCH as paymentsPATCH } from '@/app/api/admin/payments/route'

const p = h.prisma as any
const admin = { id: 'a1', name: 'Admin', role: 'admin', email: 'a@x', color: '#000' }

const post = (body: Record<string, unknown>) => newsletterPOST(new NextRequest('https://x/app/api/admin/newsletter', {
  method: 'POST', body: JSON.stringify({ subject: 'S', bodyHtml: '<p>hi</p>', segment: 'all', ...body }),
}))
const get = (qs = '') => newsletterGET(new NextRequest(`https://x/app/api/admin/newsletter${qs}`))
const patch = (body: Record<string, unknown>) => paymentsPATCH(new NextRequest('https://x/app/api/admin/payments', {
  method: 'PATCH', body: JSON.stringify(body),
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.claims.clear()
  ;(getSession as any).mockResolvedValue(admin)
  p.newsletter.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', ...data }))
  p.user.findMany.mockResolvedValue([{ id: 'u1', email: 'u@x', name: 'U' }])
  p.user.count.mockResolvedValue(0)
})

describe('newsletter scheduling reads the time on the city clock', () => {
  it('"18:00" in Istanbul is 15:00 UTC, not 18:00 UTC', async () => {
    const res = await post({ scheduledFor: '2030-01-15T18:00', scheduleTz: 'Europe/Istanbul', requestId: 'req-sched-0001' })
    expect(res.status).toBe(200)
    const stored: Date = p.newsletter.create.mock.calls[0][0].data.scheduledFor
    expect(stored.toISOString()).toBe('2030-01-15T15:00:00.000Z')
  })

  it("follows the tz it is given (New York in January is UTC-5)", async () => {
    await post({ scheduledFor: '2030-01-15T18:00', scheduleTz: 'America/New_York', requestId: 'req-sched-0002' })
    expect(p.newsletter.create.mock.calls[0][0].data.scheduledFor.toISOString()).toBe('2030-01-15T23:00:00.000Z')
  })

  it("without a tz, the admin's own city decides", async () => {
    await post({ scheduledFor: '2030-01-15T18:00', requestId: 'req-sched-0003' })
    expect(p.newsletter.create.mock.calls[0][0].data.scheduledFor.toISOString()).toBe('2030-01-15T15:00:00.000Z')
  })

  it('a time that has passed is refused — never an immediate send to the segment', async () => {
    const res = await post({ scheduledFor: '2020-01-15T18:00', scheduleTz: 'Europe/Istanbul', requestId: 'req-past-0001' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/That time has passed/)
    expect(p.newsletter.create).not.toHaveBeenCalled()
    expect(p.user.findMany).not.toHaveBeenCalled()
    expect(sendNewsletterBatch).not.toHaveBeenCalled()
  })

  it('an unknown timezone is refused rather than guessed', async () => {
    const res = await post({ scheduledFor: '2030-01-15T18:00', scheduleTz: 'EUROPE', requestId: 'req-tz-00001' })
    expect(res.status).toBe(400)
    expect(p.newsletter.create).not.toHaveBeenCalled()
  })
})

describe('newsletter sends are idempotent per requestId', () => {
  it('a send without a requestId is refused before anything goes out', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    expect(sendNewsletterBatch).not.toHaveBeenCalled()
  })

  it('the same requestId twice sends once; the second answers 409 duplicate', async () => {
    const first  = await post({ requestId: 'req-dup-00001' })
    const second = await post({ requestId: 'req-dup-00001' })
    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect((await second.json()).duplicate).toBe(true)
    expect(sendNewsletterBatch).toHaveBeenCalledTimes(1)
  })

  it('a refusal before the claim leaves the key for the corrected retry', async () => {
    p.user.findMany.mockResolvedValueOnce([])  // empty segment → 400, nothing claimed
    expect((await post({ requestId: 'req-retry-0001' })).status).toBe(400)
    expect((await post({ requestId: 'req-retry-0001' })).status).toBe(200)
  })

  it('a send where nothing went out hands the key back', async () => {
    ;(sendNewsletterBatch as any).mockResolvedValueOnce({ sent: 0, resendLogs: [], failed: [{ email: 'u@x', error: 'boom' }] })
    expect((await post({ requestId: 'req-zero-0001' })).status).toBe(502)
    expect((await post({ requestId: 'req-zero-0001' })).status).toBe(200)
  })

  it('a duplicate scheduled send is refused too', async () => {
    const body = { scheduledFor: '2030-01-15T18:00', scheduleTz: 'Europe/Istanbul', requestId: 'req-sdup-0001' }
    expect((await post(body)).status).toBe(200)
    expect((await post(body)).status).toBe(409)
    expect(p.newsletter.create).toHaveBeenCalledTimes(1)
  })
})

describe('newsletter counts follow the city picker', () => {
  it('?cityId scopes every segment count and the samples', async () => {
    p.city.findUnique.mockResolvedValue({ id: 'c-bod' })
    p.user.count.mockResolvedValue(40)
    p.user.findMany.mockResolvedValue([{ name: 'Elif Kaya' }])
    const body = await (await get('?cityId=c-bod&scope=counts')).json()
    expect(body.segmentCounts).toEqual({ all: 40, new: 40, active: 40, inactive: 40 })
    expect(body.sampleRecipients.all).toEqual(['Elif'])
    for (const [arg] of p.user.count.mock.calls) expect(arg.where.cityId).toBe('c-bod')
    for (const [arg] of p.user.findMany.mock.calls) expect(arg.where.cityId).toBe('c-bod')
    // scope=counts skips the history
    expect(p.newsletter.findMany).not.toHaveBeenCalled()
  })

  it('samples come from the segment, not the whole opted-in list', async () => {
    await get()
    const wheres = p.user.findMany.mock.calls.map(([a]: any) => a.where)
    expect(wheres.some((w: any) => w.joinedEvents)).toBe(true)  // active / inactive samples
    expect(wheres.some((w: any) => w.joinedAt)).toBe(true)      // new-member sample
  })

  it('an unknown city id is a 400, not a network-wide count', async () => {
    p.city.findUnique.mockResolvedValue(null)
    expect((await get('?cityId=nope')).status).toBe(400)
    expect(p.user.count).not.toHaveBeenCalled()
  })

  it('the new-members insert reads the picked city', async () => {
    p.city.findUnique.mockResolvedValue({ id: 'c-bod' })
    p.user.findMany.mockResolvedValue([{ name: 'Deniz Ak' }])
    const body = await (await get('?newMembers=1&cityId=c-bod')).json()
    expect(body.names).toEqual(['Deniz'])
    expect(p.user.findMany.mock.calls[0][0].where).toMatchObject({ cityId: 'c-bod', status: 'approved', hiddenFromMembers: false })
  })
})

describe('refunding a payment keeps its note', () => {
  beforeEach(() => {
    p.payment.findUnique.mockResolvedValue({ status: 'paid', amount: 300, currency: 'TRY', notes: 'paid cash to Elif' })
    p.payment.update.mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data, user: { name: 'M', email: 'm@x' }, event: { title: 'T', emoji: '🎉' } }))
  })

  it('the reason is appended, and the audit carries the note before/after', async () => {
    const res = await patch({ id: 'p1', status: 'refunded', reason: 'event cancelled' })
    expect(res.status).toBe(200)
    expect(p.payment.update.mock.calls[0][0].data).toEqual({ status: 'refunded', notes: 'paid cash to Elif · Refund: event cancelled' })
    const audit = (writeAudit as any).mock.calls.find((c: any[]) => c[2] === 'payment.status')
    expect(audit[5]).toMatchObject({ from: 'paid', to: 'refunded', reason: 'event cancelled', notesBefore: 'paid cash to Elif', notesAfter: 'paid cash to Elif · Refund: event cancelled' })
    expect(p.paymentLog.create.mock.calls[0][0].data.note).toContain('paid cash to Elif')
    expect((sendRefundEmail as any).mock.calls[0][5]).toBe('event cancelled')
  })

  it('a tab that still sends the reason as `notes` appends too, never overwrites', async () => {
    await patch({ id: 'p1', status: 'refunded', notes: 'duplicate payment' })
    expect(p.payment.update.mock.calls[0][0].data.notes).toBe('paid cash to Elif · Refund: duplicate payment')
  })

  it('a status change with no reason leaves the note alone', async () => {
    p.payment.findUnique.mockResolvedValue({ status: 'pending', amount: 300, currency: 'TRY', notes: 'keep me' })
    await patch({ id: 'p1', status: 'paid' })
    expect(p.payment.update.mock.calls[0][0].data).toEqual({ status: 'paid' })
  })
})

describe('payments filters run on the server', () => {
  it('search, status and a date range become the query, dates on the city clock', async () => {
    p.payment.count.mockResolvedValue(3)
    await paymentsGET(new NextRequest('https://x/app/api/admin/payments?status=paid&search=elif&from=2026-05-01&to=2026-05-01'))
    const where = p.payment.findMany.mock.calls[0][0].where
    expect(where.status).toBe('paid')
    // Istanbul midnight is 21:00 UTC the day before; "to" covers the whole day.
    expect(where.createdAt.gte.toISOString()).toBe('2026-04-30T21:00:00.000Z')
    expect(where.createdAt.lt.toISOString()).toBe('2026-05-01T21:00:00.000Z')
    // name, email, event title, and the member id the RSVP route links with.
    expect(where.OR).toHaveLength(4)
  })

  it('says when the matching rows run past the cap', async () => {
    p.payment.findMany.mockResolvedValue(Array.from({ length: 500 }, (_, i) => ({ id: `p${i}` })))
    p.payment.count.mockImplementation(async (arg?: any) => arg?.where && Object.keys(arg.where).length === 0 ? 900 : 900)
    const body = await (await paymentsGET(new NextRequest('https://x/app/api/admin/payments'))).json()
    expect(body.stats).toMatchObject({ matched: 900, capped: true })
    expect(body.tz).toBe('Europe/Istanbul')
  })

  it('the CSV export runs the same filters with a higher cap', async () => {
    p.payment.count.mockResolvedValue(2)
    p.payment.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const body = await (await paymentsGET(new NextRequest('https://x/app/api/admin/payments?export=1&status=refunded'))).json()
    const args = p.payment.findMany.mock.calls[0][0]
    expect(args.where.status).toBe('refunded')
    expect(args.take).toBeGreaterThan(500)
    expect(body).toMatchObject({ matched: 2, capped: false })
    expect(p.payment.groupBy).not.toHaveBeenCalled()
  })
})
