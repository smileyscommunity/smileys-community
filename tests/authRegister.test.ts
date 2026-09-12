import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'crypto'

// POST /api/auth/register — the approved-applicant path had no route coverage.
// Pins the blacklist and password gates, and on success: bcrypt hashing, the
// member landing in the application's target city, the verification token
// stored hashed, and exactly one verification email.

vi.mock('@/lib/prisma', () => ({ prisma: {
  blacklist:              { findFirst: vi.fn() },
  user:                   { findUnique: vi.fn(), create: vi.fn() },
  memberApplication:      { findFirst: vi.fn() },
  emailVerificationToken: { create: vi.fn(async () => ({})), deleteMany: vi.fn() },
  passwordResetToken:     { create: vi.fn(), deleteMany: vi.fn() },
  clubMembership:         { upsert: vi.fn() },
  club:                   { update: vi.fn() },
  $transaction:           vi.fn(async () => []),
} }))
vi.mock('@/lib/session', () => ({ createSession: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({
  sendVerificationEmail:       vi.fn(async () => {}),
  sendAlreadyRegisteredEmail:  vi.fn(async () => {}),
  sendFinishRegistrationEmail: vi.fn(async () => {}),
  recordEmailFailure:          vi.fn(async () => {}),
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), getIp: () => '1.2.3.4' }))
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true) }))
vi.mock('@/lib/neighborhoodsDb', () => ({ coerceNeighborhoodFor: vi.fn(async (_c: string, n: string) => n ?? null) }))
vi.mock('@/lib/posthog-server', () => ({ getPostHogClient: () => null, trackServer: vi.fn() }))
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => '$2a$10$hashed'), compare: vi.fn() } }))

import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { sendVerificationEmail } from '@/lib/email'
import { coerceNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { POST as register } from '@/app/api/auth/register/route'

const p = prisma as any

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Jane Doe', email: 'Jane@Example.com ', password: 'longenough1', phone: '+905551112233',
  nationality: 'DE', languages: ['en'], interests: ['dining'], neighborhood: 'Alsancak', _cf: 'ok',
  ...over,
})
const req = (b: object) =>
  new NextRequest('http://localhost/app/api/auth/register', {
    method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' },
  })

const application = {
  id: 'app1', email: 'jane@example.com', status: 'approved', targetCityId: 'c-izmir',
  phone: null, country: null, languages: [], interests: [], socialStyles: [],
  openToCoffee: false, openToLanguage: false, openToHosting: false, assignedClubs: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  p.blacklist.findFirst.mockResolvedValue(null)
  p.user.findUnique.mockResolvedValue(null)
  p.memberApplication.findFirst.mockResolvedValue(application)
  p.user.create.mockImplementation(async ({ data }: any) => ({ id: 'u-new', ...data }))
})

describe('POST /api/auth/register', () => {
  it('403s a blacklisted email and creates nothing', async () => {
    p.blacklist.findFirst.mockResolvedValue({ id: 'b1', email: 'jane@example.com' })
    const res = await register(req(body()))
    expect(res.status).toBe(403)
    expect(p.blacklist.findFirst.mock.calls[0][0].where.OR[0]).toEqual({ email: 'jane@example.com' })
    expect(bcrypt.hash).not.toHaveBeenCalled()
    expect(p.user.create).not.toHaveBeenCalled()
    expect(sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('400s a password under 8 characters before any DB lookup', async () => {
    const res = await register(req(body({ password: 'short7!' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at least 8/)
    expect(p.blacklist.findFirst).not.toHaveBeenCalled()
    expect(p.user.create).not.toHaveBeenCalled()
  })

  it('403s when there is no approved application for the email', async () => {
    p.memberApplication.findFirst.mockResolvedValue(null)
    const res = await register(req(body()))
    expect(res.status).toBe(403)
    expect(p.user.create).not.toHaveBeenCalled()
  })

  it('on success: bcrypt-hashes the password, creates the user in the application city, stores a hashed token, sends one email', async () => {
    const res = await register(req(body()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pending: true, checkEmail: true })

    expect(bcrypt.hash).toHaveBeenCalledWith('longenough1', 10)

    expect(p.user.create).toHaveBeenCalledTimes(1)
    const { data } = p.user.create.mock.calls[0][0]
    expect(data.cityId).toBe('c-izmir')
    expect(data.email).toBe('jane@example.com')
    expect(data.password).toBe('$2a$10$hashed')
    expect(data.password).not.toBe('longenough1')
    expect(data.status).toBe('approved')
    // Neighborhood is validated against the target city, not the default one.
    expect(coerceNeighborhoodFor).toHaveBeenCalledWith('c-izmir', 'Alsancak', 'register')

    expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
    const [to, , rawToken] = (sendVerificationEmail as any).mock.calls[0]
    expect(to).toBe('jane@example.com')
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/)

    expect(p.emailVerificationToken.create).toHaveBeenCalledTimes(1)
    const stored = p.emailVerificationToken.create.mock.calls[0][0].data
    expect(stored.userId).toBe('u-new')
    expect(stored.token).not.toBe(rawToken)
    expect(stored.token).toBe(createHash('sha256').update(rawToken).digest('hex'))

    // No auto-session: the member must verify first.
    expect(createSession).not.toHaveBeenCalled()
  })

  it('drops non-canonical interests rather than storing free text', async () => {
    await register(req(body({ interests: ['dining', 'not-a-real-interest'] })))
    expect(p.user.create.mock.calls[0][0].data.interests).toEqual(['dining'])
  })
})
