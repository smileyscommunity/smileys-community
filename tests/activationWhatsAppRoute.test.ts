import { describe, it, expect, vi, beforeEach } from 'vitest'

// Retention > Not activated > WhatsApp: the route mints a login link, so who
// may call it, and for whom, is the part worth pinning down.
const p = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(async () => ({})) },
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const act     = vi.hoisted(() => ({ issueActivationToken: vi.fn(async () => 'tok123') }))
const audit   = vi.hoisted(() => ({ writeAudit: vi.fn(async () => {}) }))
const limits  = vi.hoisted(() => ({ allow: true }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/activation', () => act)
vi.mock('@/lib/audit', () => audit)
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => limits.allow) }))
vi.mock('@/lib/city', () => ({ getCityTz: vi.fn(async () => 'UTC') }))
vi.mock('@/lib/env', () => ({ APP_URL: 'https://smileyscommunity.com/app', SITE_URL: 'https://smileyscommunity.com' }))

import { POST } from '@/app/api/admin/retention/whatsapp/route'

const admin = { id: 'a1', name: 'Adm', email: 'a@x', role: 'admin', cityId: 'c1' }
const req = (body: unknown) => ({ json: async () => body }) as never
const pending = { id: 'u1', name: 'Ayşe Yılmaz', phone: '+90 544 330 30 68', nationality: 'Turkey', cityId: 'c1', joinedAt: new Date(Date.now() - 5 * 86_400_000) }

beforeEach(() => {
  vi.clearAllMocks()
  session.current = admin
  limits.allow = true
})

describe('POST /api/admin/retention/whatsapp', () => {
  it('returns a wa.me link carrying a fresh activation link, and records the send', async () => {
    p.user.findFirst.mockResolvedValue(pending)
    const res = await POST(req({ userId: 'u1' }))
    expect(res.status).toBe(200)
    const { url, whatsappNudgedAt } = await res.json()
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://wa.me/905443303068')
    const text = parsed.searchParams.get('text')!
    expect(text).toContain('Hi Ayşe,')
    expect(text).toContain('approved a little while ago')
    expect(text).toContain('https://smileyscommunity.com/app/activate?token=tok123')
    expect(act.issueActivationToken).toHaveBeenCalledWith('u1')
    expect(p.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { whatsappNudgedAt: expect.any(Date) } })
    expect(typeof whatsappNudgedAt).toBe('string')
    expect(audit.writeAudit).toHaveBeenCalledWith('a1', 'Adm', 'user.activation_whatsapp', 'u1', 'user', expect.objectContaining({ cityId: 'c1' }), expect.any(String))
  })

  it('names the month for someone approved months ago', async () => {
    p.user.findFirst.mockResolvedValue({ ...pending, joinedAt: new Date(Date.now() - 150 * 86_400_000) })
    const { url } = await (await POST(req({ userId: 'u1' }))).json()
    expect(new URL(url).searchParams.get('text')).toMatch(/You were approved back in [A-Z][a-z]+( \d{4})?,/)
  })

  it('only looks up approved members who never set a password', async () => {
    p.user.findFirst.mockResolvedValue(pending)
    await POST(req({ userId: 'u1' }))
    expect(p.user.findFirst.mock.calls[0][0].where).toEqual({ id: 'u1', status: 'approved', password: null })
  })

  it.each(['moderator', 'member'])('refuses a %s: the link carries a phone number they never see', async (role) => {
    session.current = { ...admin, role }
    const res = await POST(req({ userId: 'u1' }))
    expect(res.status).toBe(403)
    expect(act.issueActivationToken).not.toHaveBeenCalled()
  })

  it('says so when the member activated since the list loaded, and mints nothing', async () => {
    p.user.findFirst.mockResolvedValue(null)
    p.user.findUnique.mockResolvedValue({ status: 'approved', password: 'hash' })
    const res = await POST(req({ userId: 'u1' }))
    expect(res.status).toBe(409)
    expect(act.issueActivationToken).not.toHaveBeenCalled()
  })

  it('leaves the emailed link alone when there is no usable number', async () => {
    p.user.findFirst.mockResolvedValue({ ...pending, phone: 'n/a' })
    const res = await POST(req({ userId: 'u1' }))
    expect(res.status).toBe(422)
    expect(act.issueActivationToken).not.toHaveBeenCalled()
    expect(p.user.update).not.toHaveBeenCalled()
  })

  it('rejects a missing id and a rate-limited caller before touching anything', async () => {
    expect((await POST(req({}))).status).toBe(400)
    limits.allow = false
    expect((await POST(req({ userId: 'u1' }))).status).toBe(429)
    expect(p.user.findFirst).not.toHaveBeenCalled()
  })
})
