import { describe, it, expect, vi, beforeEach } from 'vitest'

const create = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { sponsorLead: { create: (...a: unknown[]) => create(...a) } } }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: async () => true, getIp: () => '1.2.3.4' }))
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: async () => true }))
vi.mock('resend', () => ({ Resend: class { emails = { send: async () => { throw new Error('mail down') } } } }))

import { POST } from '@/app/api/partners/enquiry/route'

const good = { name: 'Ada', organization: 'Gig Co', email: 'ada@gigco.com', eventName: 'Gig', eventWebsite: 'https://gig.example.com', collaboration: 'coverage', message: 'We run a concert in November.', _t: 1 }
const call = (b: unknown) => POST(new Request('http://x/api/partners/enquiry', { method: 'POST', body: JSON.stringify(b) }) as never)

beforeEach(() => { create.mockReset(); create.mockResolvedValue({ id: 'lead1' }); process.env.RESEND_API_KEY = 'x' })

describe('POST /api/partners/enquiry', () => {
  it('stores the lead and confirms only after the row exists, even if email fails', async () => {
    const r = await call(good)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, id: 'lead1' })
    expect(create.mock.calls[0][0].data).toMatchObject({ format: 'partner_coverage', source: 'partners', eventName: 'Gig' })
  })
  it('does NOT claim success when the database write fails', async () => {
    create.mockRejectedValue(new Error('db down'))
    const r = await call(good)
    expect(r.status).toBe(500)
    expect((await r.json()).ok).toBeUndefined()
  })
  it.each([
    ['unsafe website', { eventWebsite: 'javascript:alert(1)' }],
    ['http website', { eventWebsite: 'http://gig.example.com' }],
    ['bad email', { email: 'nope' }],
    ['unknown collaboration', { collaboration: 'zzz' }],
    ['missing org', { organization: '' }],
    ['short message', { message: 'hi' }],
    ['bad date', { eventDate: '11/20/2026' }],
    ['disposable email', { email: 'x@mailinator.com' }],
  ])('rejects %s without writing', async (_n, patch) => {
    const r = await call({ ...good, ...patch })
    expect(r.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })
  it('silently drops a honeypot hit without writing', async () => {
    const r = await call({ ...good, _hp: 'bot' })
    expect(r.status).toBe(200)
    expect(create).not.toHaveBeenCalled()
  })
})
