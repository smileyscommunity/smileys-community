import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// 235 approved members never activated: the link died after 7 days, the
// expired-link page offered only an email address, and forgot-password
// returned ok while sending nothing for an account with no password
// (2026-09-08). Two ways back in now: the expired page's "send me a new
// link", which takes the old token as proof, and forgot-password issuing an
// activation link for an approved, never-activated account.

const sent: any[] = []
vi.mock('@/lib/prisma', () => ({ prisma: {
  passwordResetToken: { findUnique: vi.fn(), deleteMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(async () => ({})) },
  user: { findUnique: vi.fn() },
} }))
vi.mock('@/lib/email', () => ({
  sendNewActivationLinkEmail: vi.fn(async (...a: any[]) => { sent.push(['activation', ...a]) }),
  sendPasswordResetEmail:     vi.fn(async (...a: any[]) => { sent.push(['reset', ...a]) }),
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true), getIp: () => '1.2.3.4' }))
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true) }))

import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rateLimit'
import { POST as resend } from '@/app/api/auth/activate/resend/route'
import { POST as forgot } from '@/app/api/auth/forgot-password/route'
import { GET as activateGet } from '@/app/api/auth/activate/route'
import { maskEmail } from '@/lib/activation'

const p = prisma as any
const req = (body: object, url = 'http://localhost/app/api/x') =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const past   = new Date(Date.now() - 24 * 3600 * 1000)
const future = new Date(Date.now() + 24 * 3600 * 1000)

beforeEach(() => { vi.clearAllMocks(); sent.length = 0 })

describe('GET /api/auth/activate', () => {
  it('tells the page an expired-but-real token is expired, so it can offer a new one', async () => {
    p.passwordResetToken.findUnique.mockResolvedValue({ userId: 'u1', used: false, expiresAt: past })
    const res = await activateGet(new NextRequest('http://localhost/app/api/auth/activate?token=abc'))
    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ expired: true })
  })

  it('still treats an unknown or used token as plain invalid', async () => {
    p.passwordResetToken.findUnique.mockResolvedValue(null)
    const r1 = await activateGet(new NextRequest('http://localhost/app/api/auth/activate?token=abc'))
    expect(r1.status).toBe(400)
    expect((await r1.json()).expired).toBeUndefined()
    p.passwordResetToken.findUnique.mockResolvedValue({ userId: 'u1', used: true, expiresAt: future })
    const r2 = await activateGet(new NextRequest('http://localhost/app/api/auth/activate?token=abc'))
    expect(r2.status).toBe(400)
  })
})

describe('POST /api/auth/activate/resend', () => {
  it('mints a fresh link for an approved, never-activated member and says where it went', async () => {
    p.passwordResetToken.findUnique.mockResolvedValue({ userId: 'u1', used: false, expiresAt: past })
    p.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Jane Doe', email: 'jane@example.com', status: 'approved', password: null })
    const res = await resend(req({ token: 'old' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, email: 'j***@example.com' })
    expect(p.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(p.passwordResetToken.create).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(1)
    expect(sent[0].slice(0, 3)).toEqual(['activation', 'jane@example.com', 'Jane Doe'])
    expect(sent[0][3]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses an already-activated or non-approved account, and a used token', async () => {
    p.passwordResetToken.findUnique.mockResolvedValue({ userId: 'u1', used: false, expiresAt: past })
    p.user.findUnique.mockResolvedValue({ id: 'u1', name: 'J', email: 'j@x.com', status: 'approved', password: 'hash' })
    expect((await resend(req({ token: 'old' }))).status).toBe(400)
    p.user.findUnique.mockResolvedValue({ id: 'u1', name: 'J', email: 'j@x.com', status: 'pending', password: null })
    expect((await resend(req({ token: 'old' }))).status).toBe(400)
    p.passwordResetToken.findUnique.mockResolvedValue({ userId: 'u1', used: true, expiresAt: past })
    expect((await resend(req({ token: 'old' }))).status).toBe(400)
    expect(sent).toHaveLength(0)
  })

  it('is rate-limited per account so the button cannot be hammered', async () => {
    p.passwordResetToken.findUnique.mockResolvedValue({ userId: 'u1', used: false, expiresAt: past })
    p.user.findUnique.mockResolvedValue({ id: 'u1', name: 'J', email: 'j@x.com', status: 'approved', password: null })
    ;(rateLimit as any).mockImplementation(async (key: string) => !key.startsWith('activate-resend-user:'))
    expect((await resend(req({ token: 'old' }))).status).toBe(429)
    expect(sent).toHaveLength(0)
  })
})

describe('POST /api/auth/forgot-password', () => {
  it('sends an activation link, not silence, to an approved member with no password', async () => {
    p.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Jane Doe', email: 'jane@example.com', status: 'approved', password: null })
    const res = await forgot(req({ email: 'Jane@Example.com', _cf: 't' }))
    expect(await res.json()).toEqual({ ok: true })
    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toBe('activation')
    expect(p.passwordResetToken.create).toHaveBeenCalledTimes(1)
  })

  it('stays silent for a pending applicant with no password', async () => {
    p.user.findUnique.mockResolvedValue({ id: 'u1', name: 'J', email: 'j@x.com', status: 'pending', password: null })
    const res = await forgot(req({ email: 'j@x.com', _cf: 't' }))
    expect(await res.json()).toEqual({ ok: true })
    expect(sent).toHaveLength(0)
  })

  it('still sends the ordinary reset email to an activated member', async () => {
    p.user.findUnique.mockResolvedValue({ id: 'u1', name: 'J', email: 'j@x.com', status: 'approved', password: 'hash' })
    await forgot(req({ email: 'j@x.com', _cf: 't' }))
    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toBe('reset')
  })
})

describe('maskEmail', () => {
  it('keeps one letter and the domain', () => {
    expect(maskEmail('kaan@gmail.com')).toBe('k***@gmail.com')
    expect(maskEmail('nonsense')).toBe('***')
  })
})
