import { describe, it, expect, vi, beforeEach } from 'vitest'

// Retention > Not activated > Last-call email: a bulk email to members, so
// the guards are the point — who may press it, and that nobody gets it twice.
const p = vi.hoisted(() => ({
  user: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(async () => ({})), count: vi.fn(async () => 0) },
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const mail    = vi.hoisted(() => ({ sendActivationLastCallEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}) }))
const act     = vi.hoisted(() => ({ addActivationToken: vi.fn(async () => 'tok'), issueActivationToken: vi.fn() }))
const claims  = vi.hoisted(() => ({ free: true, released: [] as string[] }))
const stepUp  = vi.hoisted(() => ({ block: false }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/email', () => mail)
vi.mock('@/lib/activation', () => act)
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/city', () => ({ getCityTz: vi.fn(async () => 'Europe/Istanbul') }))
vi.mock('@/lib/rateLimit', () => ({
  claimOnce:    vi.fn(async () => claims.free),
  releaseClaim: vi.fn(async (k: string) => { claims.released.push(k) }),
}))
vi.mock('@/lib/stepUp', () => ({
  requireStepUp: vi.fn(() => stepUp.block ? new Response(JSON.stringify({ error: 'Two-factor verification required' }), { status: 403 }) : null),
}))

import { POST } from '@/app/api/admin/retention/last-call/route'
import { lastCallWhere, LAST_CALL_BATCH } from '@/lib/activationLastCall'

const admin = { id: 'a1', name: 'Adm', email: 'a@x', role: 'admin', cityId: 'c1' }
const member = (id: string, monthsAgo: number) => ({
  id, name: `Member ${id}`, email: `${id}@x.com`, cityId: 'c1',
  joinedAt: new Date(Date.now() - monthsAgo * 30 * 86_400_000),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 })
  session.current = admin
  claims.free = true
  claims.released = []
  stepUp.block = false
  p.user.updateMany.mockResolvedValue({ count: 1 })
})

describe('lastCallWhere', () => {
  it('picks never-activated members past the 60-day reminder window who have not had it', () => {
    const now = new Date('2026-10-13T10:00:00Z')
    expect(lastCallWhere(now)).toEqual({
      status: 'approved', password: null,
      role: { notIn: ['admin', 'partner'] },
      joinedAt: { lt: new Date('2026-08-14T10:00:00Z') },
      activationLastCallAt: null,
    })
  })
})

describe('POST /api/admin/retention/last-call', () => {
  it('emails a batch, each with a fresh link and the month they were approved', async () => {
    p.user.findMany.mockResolvedValue([member('u1', 4), member('u2', 5)])
    p.user.count.mockResolvedValue(190)
    const res = await POST()
    expect(await res.json()).toEqual({ sent: 2, failed: 0, remaining: 190 })
    expect(p.user.findMany.mock.calls[0][0].take).toBe(LAST_CALL_BATCH)
    expect(mail.sendActivationLastCallEmail).toHaveBeenCalledTimes(2)
    const [, , token, when] = mail.sendActivationLastCallEmail.mock.calls[0] as unknown as string[]
    expect(token).toBe('tok')
    expect(when).toMatch(/^back in [A-Z][a-z]+( \d{4})?$/)
  })

  it('adds a link without cancelling one already sent on WhatsApp', async () => {
    p.user.findMany.mockResolvedValue([member('u1', 4)])
    await POST()
    expect(act.addActivationToken).toHaveBeenCalledWith('u1', expect.any(Date))
    expect(act.issueActivationToken).not.toHaveBeenCalled()
  })

  it('claims each member before emailing, and skips one another press already took', async () => {
    p.user.findMany.mockResolvedValue([member('u1', 4), member('u2', 4)])
    p.user.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const body = await (await POST()).json()
    expect(body.sent).toBe(1)
    expect(mail.sendActivationLastCallEmail).toHaveBeenCalledTimes(1)
    expect(p.user.updateMany.mock.calls[0][0].where).toEqual({ id: 'u1', activationLastCallAt: null, password: null })
  })

  it('a failed send puts the member back in the queue', async () => {
    p.user.findMany.mockResolvedValue([member('u1', 4)])
    mail.sendActivationLastCallEmail.mockRejectedValueOnce(new Error('resend down'))
    const body = await (await POST()).json()
    expect(body).toMatchObject({ sent: 0, failed: 1 })
    expect(p.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { activationLastCallAt: null } })
    expect(mail.recordEmailFailure).toHaveBeenCalled()
  })

  it.each(['moderator', 'member'])('refuses a %s', async (role) => {
    session.current = { ...admin, role }
    expect((await POST()).status).toBe(403)
    expect(p.user.findMany).not.toHaveBeenCalled()
  })

  it('needs the same second factor as a newsletter send', async () => {
    stepUp.block = true
    expect((await POST()).status).toBe(403)
    expect(p.user.findMany).not.toHaveBeenCalled()
  })

  it('one batch at a time per admin, and the lock is released afterwards', async () => {
    claims.free = false
    expect((await POST()).status).toBe(409)
    expect(p.user.findMany).not.toHaveBeenCalled()
    claims.free = true
    p.user.findMany.mockResolvedValue([])
    await POST()
    expect(claims.released).toEqual(['activation-last-call:a1'])
  })
})
