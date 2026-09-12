import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT } from 'jose'

// getSession() is the single real-time revocation point: every authenticated
// request re-checks ban/suspension, tokenVersion (logout-everywhere) and the
// per-device Session row. Tokens here are signed for real with the vitest
// JWT_SECRET so jwtVerify runs unmocked.

const store = {
  get:    vi.fn(),
  set:    vi.fn(),
  delete: vi.fn(),
}
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => store) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  user:    { findUnique: vi.fn() },
  session: { findUnique: vi.fn(), update: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 1 })) },
} }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

const p = prisma as any
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

const sign = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').sign(SECRET)

const jwtUser = (over: Record<string, unknown> = {}) =>
  ({ id: 'u1', name: 'Jane', email: 'old@example.com', role: 'member', color: '#fff', tokenVersion: 2, ...over })

const dbUser = (over: Record<string, unknown> = {}) => ({
  status: 'approved', suspendedUntil: null, tokenVersion: 2, cityId: 'c-ist',
  email: 'jane@example.com', totpEnabled: false, neighborhood: 'Kadıköy', ...over,
})

const future = () => new Date(Date.now() + 24 * 3600_000)
const past   = () => new Date(Date.now() - 1000)

async function withCookie(claims: Record<string, unknown>) {
  const token = await sign(claims)
  store.get.mockImplementation((name: string) => (name === 'smileys_session' ? { value: token } : undefined))
}

const sessionCleared = () => store.delete.mock.calls.some(c => c[0] === 'smileys_session')

beforeEach(() => {
  vi.clearAllMocks()
  store.get.mockReturnValue(undefined)
})

describe('getSession', () => {
  it('resolves a valid jti session and injects live DB fields', async () => {
    await withCookie({ user: jwtUser(), jti: 's1' })
    p.user.findUnique.mockResolvedValue(dbUser())
    p.session.findUnique.mockResolvedValue({ id: 's1', expiresAt: future(), revokedAt: null, totpVerified: true })
    const s = await getSession()
    expect(s).toMatchObject({ id: 'u1', email: 'jane@example.com', cityId: 'c-ist', sessionId: 's1', totpVerified: true })
    expect(p.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }))
    expect(sessionCleared()).toBe(false)
  })

  it('returns null with no cookie, without a DB round trip', async () => {
    expect(await getSession()).toBeNull()
    expect(p.user.findUnique).not.toHaveBeenCalled()
  })

  it('a JWT whose tokenVersion differs from the DB row is cleared and returns null', async () => {
    await withCookie({ user: jwtUser({ tokenVersion: 1 }), jti: 's1' })
    p.user.findUnique.mockResolvedValue(dbUser({ tokenVersion: 2 }))
    p.session.findUnique.mockResolvedValue({ id: 's1', expiresAt: future(), revokedAt: null, totpVerified: false })
    expect(await getSession()).toBeNull()
    expect(sessionCleared()).toBe(true)
    expect(p.session.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } })
  })

  it('a pre-tokenVersion JWT (no claim) is treated as 0 and rejected once the DB has moved on', async () => {
    await withCookie({ user: jwtUser({ tokenVersion: undefined }) })
    p.user.findUnique.mockResolvedValue(dbUser({ tokenVersion: 1 }))
    expect(await getSession()).toBeNull()
    expect(sessionCleared()).toBe(true)
  })

  it('a banned user returns null and sets the "banned" sign-out reason', async () => {
    await withCookie({ user: jwtUser(), jti: 's1' })
    p.user.findUnique.mockResolvedValue(dbUser({ status: 'banned' }))
    p.session.findUnique.mockResolvedValue({ id: 's1', expiresAt: future(), revokedAt: null, totpVerified: false })
    expect(await getSession()).toBeNull()
    expect(sessionCleared()).toBe(true)
    expect(store.set.mock.calls.find(c => c[0] === 'smileys_signed_out')?.[1]).toBe('banned')
  })

  it('a currently suspended user returns null and sets the "suspended" sign-out reason', async () => {
    await withCookie({ user: jwtUser(), jti: 's1' })
    p.user.findUnique.mockResolvedValue(dbUser({ suspendedUntil: future() }))
    p.session.findUnique.mockResolvedValue({ id: 's1', expiresAt: future(), revokedAt: null, totpVerified: false })
    expect(await getSession()).toBeNull()
    expect(store.set.mock.calls.find(c => c[0] === 'smileys_signed_out')?.[1]).toBe('suspended')
  })

  it('a deleted user (no DB row) returns null', async () => {
    await withCookie({ user: jwtUser(), jti: 's1' })
    p.user.findUnique.mockResolvedValue(null)
    p.session.findUnique.mockResolvedValue({ id: 's1', expiresAt: future(), revokedAt: null, totpVerified: false })
    expect(await getSession()).toBeNull()
    expect(sessionCleared()).toBe(true)
  })

  it('a jti whose Session row has revokedAt set returns null', async () => {
    await withCookie({ user: jwtUser(), jti: 's1' })
    p.user.findUnique.mockResolvedValue(dbUser())
    p.session.findUnique.mockResolvedValue({ id: 's1', expiresAt: future(), revokedAt: past(), totpVerified: false })
    expect(await getSession()).toBeNull()
    expect(sessionCleared()).toBe(true)
    expect(p.session.update).not.toHaveBeenCalled()
  })

  it('a jti whose Session row expiresAt is in the past returns null', async () => {
    await withCookie({ user: jwtUser(), jti: 's1' })
    p.user.findUnique.mockResolvedValue(dbUser())
    p.session.findUnique.mockResolvedValue({ id: 's1', expiresAt: past(), revokedAt: null, totpVerified: false })
    expect(await getSession()).toBeNull()
    expect(sessionCleared()).toBe(true)
  })

  it('a jti with no Session row at all returns null', async () => {
    await withCookie({ user: jwtUser(), jti: 'gone' })
    p.user.findUnique.mockResolvedValue(dbUser())
    p.session.findUnique.mockResolvedValue(null)
    expect(await getSession()).toBeNull()
  })

  it('a legacy token with no jti still resolves, skipping the Session lookup', async () => {
    await withCookie({ user: jwtUser() })
    p.user.findUnique.mockResolvedValue(dbUser())
    const s = await getSession()
    expect(s).toMatchObject({ id: 'u1', cityId: 'c-ist', totpVerified: false })
    expect(s?.sessionId).toBeUndefined()
    expect(p.session.findUnique).not.toHaveBeenCalled()
    expect(sessionCleared()).toBe(false)
  })

  it('a token signed with a different secret returns null without querying the DB', async () => {
    const forged = await new SignJWT({ user: jwtUser(), jti: 's1' })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d')
      .sign(new TextEncoder().encode('some-other-secret'))
    store.get.mockImplementation((name: string) => (name === 'smileys_session' ? { value: forged } : undefined))
    expect(await getSession()).toBeNull()
    expect(p.user.findUnique).not.toHaveBeenCalled()
  })
})
