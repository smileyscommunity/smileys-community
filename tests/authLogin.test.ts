import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/auth/login had no route-level coverage. These pin the gates in the
// order the handler applies them: per-IP rate limit, password check (with the
// per-account lockout only on WRONG guesses), status gates, then either the
// 2FA pending cookie or a full session carrying tokenVersion.

vi.mock('@/lib/prisma', () => ({ prisma: {
  user:           { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  clubMembership: { count: vi.fn(async () => 0) },
} }))
vi.mock('@/lib/session', () => ({ createSession: vi.fn(async () => {}) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), getIp: () => '1.2.3.4' }))
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true) }))
vi.mock('@/lib/email', () => ({
  sendNewDeviceLoginEmail: vi.fn(async () => {}),
  sendAccountLockedEmail:  vi.fn(async () => {}),
  recordEmailFailure:      vi.fn(async () => {}),
}))
vi.mock('@/lib/push', () => ({ sendPushToUser: vi.fn(async () => {}) }))
vi.mock('@/lib/access', () => ({ hostCityIds: vi.fn(async () => []) }))
vi.mock('@/lib/city', () => ({ getCityConfig: vi.fn(async () => ({ name: 'Istanbul', timezone: 'Europe/Istanbul' })) }))
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn() } }))

import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { POST as login } from '@/app/api/auth/login/route'

const p = prisma as any
const compare = (bcrypt as any).compare as ReturnType<typeof vi.fn>

const req = (body: object = { email: 'Jane@Example.com', password: 'hunter22', _cf: 'ok' }) =>
  new NextRequest('http://localhost/app/api/auth/login', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
  })

const baseUser = (over: Record<string, unknown> = {}) => ({
  id: 'u1', name: 'Jane Doe', email: 'jane@example.com', role: 'member', color: '#fff',
  bio: null, neighborhood: null, instagram: null, emailVerified: true, partnerId: null,
  password: '$2a$10$hash', status: 'approved', suspendedUntil: null, suspensionNote: null,
  totpEnabled: false, failedLoginCount: 0, loginLockedUntil: null,
  knownIps: ['1.2.3.4'], fingerprints: [], tokenVersion: 7, cityId: 'c-ist',
  ...over,
})

const updates = () => p.user.update.mock.calls.map((c: any[]) => c[0])

beforeEach(() => {
  vi.clearAllMocks()
  ;(rateLimit as any).mockImplementation(async () => true)
})

describe('POST /api/auth/login', () => {
  it('answers 429 once the per-IP rate limit refuses, before touching the user or bcrypt', async () => {
    ;(rateLimit as any).mockImplementation(async () => false)
    const res = await login(req())
    expect(res.status).toBe(429)
    expect((rateLimit as any).mock.calls[0][0]).toBe('login:1.2.3.4')
    expect(p.user.findUnique).not.toHaveBeenCalled()
    expect(compare).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('a wrong password increments failedLoginCount and returns the generic 401', async () => {
    p.user.findUnique.mockResolvedValue(baseUser({ failedLoginCount: 3 }))
    compare.mockResolvedValue(false)
    const res = await login(req())
    expect(res.status).toBe(401)
    expect(updates()).toEqual([{ where: { id: 'u1' }, data: { failedLoginCount: 4, loginLockedUntil: undefined } }])
    expect(createSession).not.toHaveBeenCalled()
  })

  it('the 10th wrong password sets loginLockedUntil about an hour out', async () => {
    p.user.findUnique.mockResolvedValue(baseUser({ failedLoginCount: 9 }))
    compare.mockResolvedValue(false)
    await login(req())
    const { data } = updates()[0]
    expect(data.failedLoginCount).toBe(10)
    expect(data.loginLockedUntil).toBeInstanceOf(Date)
    expect(data.loginLockedUntil.getTime() - Date.now()).toBeGreaterThan(59 * 60_000)
  })

  it('a wrong password on a locked account is refused with 429 and does NOT increment further', async () => {
    p.user.findUnique.mockResolvedValue(baseUser({ failedLoginCount: 10, loginLockedUntil: new Date(Date.now() + 30 * 60_000) }))
    compare.mockResolvedValue(false)
    const res = await login(req())
    expect(res.status).toBe(429)
    expect(p.user.update).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('a CORRECT password on a locked account still signs in (lockout-DoS fix in the route)', async () => {
    // The route deliberately verifies the password first and only enforces the
    // lock on a wrong guess, so an attacker can't lock the real owner out.
    p.user.findUnique.mockResolvedValue(baseUser({ failedLoginCount: 10, loginLockedUntil: new Date(Date.now() + 30 * 60_000) }))
    compare.mockResolvedValue(true)
    const res = await login(req())
    expect(res.status).toBe(200)
    expect(updates()[0]).toEqual({ where: { id: 'u1' }, data: { failedLoginCount: 0, loginLockedUntil: null } })
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['banned',  { status: 'banned' }],
    ['pending', { status: 'pending' }],
    ['suspended', { suspendedUntil: new Date(Date.now() + 24 * 3600_000) }],
  ])('%s user with the right password gets 403 and no session cookie', async (_label, over) => {
    p.user.findUnique.mockResolvedValue(baseUser(over))
    compare.mockResolvedValue(true)
    const res = await login(req())
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('a correct login resets the counter and mints a session carrying tokenVersion', async () => {
    p.user.findUnique.mockResolvedValue(baseUser({ failedLoginCount: 4 }))
    compare.mockResolvedValue(true)
    const res = await login(req())
    expect(res.status).toBe(200)
    expect(p.user.findUnique.mock.calls[0][0].where).toEqual({ email: 'jane@example.com' })
    expect(updates()[0]).toEqual({ where: { id: 'u1' }, data: { failedLoginCount: 0, loginLockedUntil: null } })
    expect(createSession).toHaveBeenCalledTimes(1)
    const [sessUser, opts] = (createSession as any).mock.calls[0]
    expect(sessUser).toMatchObject({ id: 'u1', email: 'jane@example.com', role: 'member', tokenVersion: 7 })
    expect(opts).toMatchObject({ userAgent: 'vitest', ip: '1.2.3.4' })
    const body = await res.json()
    expect(body).toMatchObject({ id: 'u1', initials: 'JD' })
    expect(body.password).toBeUndefined()
  })

  it('with totpEnabled, sets only the short-lived 2FA pending cookie — never the full session', async () => {
    p.user.findUnique.mockResolvedValue(baseUser({ totpEnabled: true }))
    compare.mockResolvedValue(true)
    const res = await login(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ requires2FA: true })
    expect(createSession).not.toHaveBeenCalled()
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('smileys_2fa_pending=')
    expect(setCookie).not.toContain('smileys_session=')
    expect(res.cookies.get('smileys_2fa_pending')?.maxAge).toBe(300)
  })

  it('an unknown email still burns a bcrypt compare and returns the same generic 401', async () => {
    p.user.findUnique.mockResolvedValue(null)
    compare.mockResolvedValue(false)
    const res = await login(req())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid email or password' })
    expect(compare).toHaveBeenCalledTimes(1)
  })
})
