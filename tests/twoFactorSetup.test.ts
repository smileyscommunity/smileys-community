import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/session',   () => ({ getSession: vi.fn(), createSession: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue(true), getIp: vi.fn().mockReturnValue('203.0.113.9') }))
vi.mock('@/lib/access',    () => ({ hostCityIds: vi.fn().mockResolvedValue([]) }))
// Reversible stand-in for AES-GCM so the test can tell what was stored.
vi.mock('@/lib/totpCrypto', () => ({
  encryptTotpSecret: vi.fn((s: string) => `enc(${s})`),
  decryptTotpSecret: vi.fn((s: string) => s.replace(/^enc\((.*)\)$/, '$1')),
}))
vi.mock('otplib/functional', () => ({
  generateSecret: vi.fn(() => 'PLAINSECRET'),
  generateURI:    vi.fn(() => 'otpauth://totp/x?secret=PLAINSECRET'),
  verifySync:     vi.fn(() => ({ valid: true })),
}))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') } }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction:    vi.fn(),
  user:            { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  totpBackupCode:  { deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  session:         { update: vi.fn() },
  clubMembership:  { count: vi.fn() },
} }))

import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import { createHash } from 'crypto'
import { GET as setupGET, POST as setupPOST, DELETE as setupDELETE } from '@/app/api/auth/2fa/setup/route'
import { POST as verifyPOST } from '@/app/api/auth/2fa/verify/route'
import { getSession, createSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { generateSecret, verifySync } from 'otplib/functional'

// Three promises the 2FA routes make: the seed is never handed out once 2FA
// is on, backup codes are kept only as hashes, and one observed TOTP step
// cannot be spent twice (login verify, or the verify → disable replay).

const p = prisma as any
const NOW = new Date('2026-09-13T10:00:05Z')
const STEP = Math.floor(NOW.getTime() / 30000)

const jsonReq = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`https://x.test/app/api/auth/2fa/${url}`, {
    method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  })

// The DB's guard-in-WHERE step claim, evaluated against a single stored user row.
function fakeStepClaim(row: { lastUsedTotpStep: number | null }) {
  p.user.updateMany.mockImplementation(async ({ where, data }: any) => {
    const ok = where.OR.some((c: any) =>
      (c.lastUsedTotpStep === null && row.lastUsedTotpStep === null) ||
      (c.lastUsedTotpStep?.lt !== undefined && row.lastUsedTotpStep !== null && row.lastUsedTotpStep < c.lastUsedTotpStep.lt))
    if (!ok) return { count: 0 }
    row.lastUsedTotpStep = data.lastUsedTotpStep
    return { count: 1 }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  ;(getSession as any).mockResolvedValue({ id: 'adm1', name: 'Admin', role: 'admin', sessionId: 's1' })
  ;(verifySync as any).mockReturnValue({ valid: true })
  p.$transaction.mockImplementation(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(p))
  p.user.update.mockResolvedValue({})
  p.totpBackupCode.deleteMany.mockResolvedValue({ count: 0 })
  p.totpBackupCode.createMany.mockResolvedValue({ count: 10 })
  p.totpBackupCode.count.mockResolvedValue(10)
  p.session.update.mockResolvedValue({})
  p.clubMembership.count.mockResolvedValue(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('2FA setup GET — the seed is never returned once enabled', () => {
  it('already enabled → 400 with no secret, no QR, no new seed written', async () => {
    p.user.findUnique.mockResolvedValue({ totpEnabled: true, email: 'a@x.test' })
    const res = await setupGET()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).not.toHaveProperty('secret')
    expect(body).not.toHaveProperty('qrDataUrl')
    expect(JSON.stringify(body)).not.toContain('PLAINSECRET')
    expect(generateSecret).not.toHaveBeenCalled()
    expect(p.user.update).not.toHaveBeenCalled()
  })

  it('not yet enabled → returns the fresh seed and stores it encrypted, not plain', async () => {
    p.user.findUnique.mockResolvedValue({ totpEnabled: false, email: 'a@x.test' })
    const res = await setupGET()
    expect(res.status).toBe(200)
    expect((await res.json()).secret).toBe('PLAINSECRET')
    expect(p.user.update).toHaveBeenCalledWith({ where: { id: 'adm1' }, data: { totpSecret: 'enc(PLAINSECRET)' } })
  })

  it('members cannot enroll at all', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'm1', role: 'member' })
    const res = await setupGET()
    expect(res.status).toBe(403)
    expect(p.user.findUnique).not.toHaveBeenCalled()
  })
})

describe('2FA setup POST — enabling', () => {
  it('stores SHA-256 hashes of the backup codes, never the plaintext, and returns the plaintext once', async () => {
    p.user.findUnique.mockResolvedValue({ totpSecret: 'enc(PLAINSECRET)', totpEnabled: false })
    const res = await setupPOST(jsonReq('setup', 'POST', { code: '123456' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.backupCodes).toHaveLength(10)
    expect(body).not.toHaveProperty('secret')
    expect(JSON.stringify(body)).not.toContain('PLAINSECRET')

    const stored = p.totpBackupCode.createMany.mock.calls[0][0].data
    expect(stored).toHaveLength(10)
    const storedJson = JSON.stringify(stored)
    for (const code of body.backupCodes as string[]) {
      expect(storedJson).not.toContain(code)
      expect(storedJson).not.toContain(code.replace('-', ''))
    }
    const expected = (body.backupCodes as string[]).map(c =>
      createHash('sha256').update(c.toUpperCase().replace(/-/g, '')).digest('hex'))
    expect(stored.map((r: any) => r.codeHash).sort()).toEqual(expected.sort())
    for (const r of stored) {
      expect(r.userId).toBe('adm1')
      expect(Object.keys(r).sort()).toEqual(['codeHash', 'userId'])
    }
    // Old codes wiped, flag flipped, current session marked verified.
    expect(p.totpBackupCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'adm1' } })
    expect(p.user.update).toHaveBeenCalledWith({ where: { id: 'adm1' }, data: { totpEnabled: true } })
    expect(p.session.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { totpVerified: true } })
  })

  it('already enabled → 400 and no new codes are minted', async () => {
    p.user.findUnique.mockResolvedValue({ totpSecret: 'enc(PLAINSECRET)', totpEnabled: true })
    const res = await setupPOST(jsonReq('setup', 'POST', { code: '123456' }))
    expect(res.status).toBe(400)
    expect(p.totpBackupCode.createMany).not.toHaveBeenCalled()
  })

  it('a wrong code enables nothing', async () => {
    p.user.findUnique.mockResolvedValue({ totpSecret: 'enc(PLAINSECRET)', totpEnabled: false })
    ;(verifySync as any).mockReturnValue({ valid: false })
    const res = await setupPOST(jsonReq('setup', 'POST', { code: '000000' }))
    expect(res.status).toBe(400)
    expect(p.$transaction).not.toHaveBeenCalled()
  })
})

describe('2FA setup DELETE — replayed step cannot disable 2FA', () => {
  it('a code whose step was already claimed (lastUsedTotpStep === current) → 400, 2FA stays on', async () => {
    const row = { lastUsedTotpStep: STEP as number | null }
    fakeStepClaim(row)
    p.user.findUnique.mockResolvedValue({ totpSecret: 'enc(PLAINSECRET)', totpEnabled: true, lastUsedTotpStep: STEP })

    const res = await setupDELETE(jsonReq('setup', 'DELETE', { code: '123456' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already used/)
    expect(p.$transaction).not.toHaveBeenCalled()
    expect(p.totpBackupCode.deleteMany).not.toHaveBeenCalled()
    // The claim is guarded in the WHERE, keyed to the current 30s step.
    expect(p.user.updateMany.mock.calls[0][0].where).toEqual({
      id: 'adm1', OR: [{ lastUsedTotpStep: null }, { lastUsedTotpStep: { lt: STEP } }],
    })
  })

  it('a fresh step disables 2FA and wipes secret + backup codes', async () => {
    fakeStepClaim({ lastUsedTotpStep: STEP - 1 })
    p.user.findUnique.mockResolvedValue({ totpSecret: 'enc(PLAINSECRET)', totpEnabled: true, lastUsedTotpStep: STEP - 1 })
    const res = await setupDELETE(jsonReq('setup', 'DELETE', { code: '123456' }))
    expect(res.status).toBe(200)
    expect(p.user.update).toHaveBeenCalledWith({
      where: { id: 'adm1' }, data: { totpEnabled: false, totpSecret: null, lastUsedTotpStep: STEP },
    })
    expect(p.totpBackupCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'adm1' } })
  })
})

describe('2FA verify POST (login) — replay and secrecy', () => {
  const pendingCookie = async () => {
    const token = await new SignJWT({ pending2fa: true, userId: 'adm1' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(process.env.JWT_SECRET))
    return { cookie: `smileys_2fa_pending=${token}` }
  }
  const userRow = (lastUsedTotpStep: number | null) => ({
    id: 'adm1', name: 'Ada Admin', email: 'a@x.test', role: 'admin', color: '#000', bio: null,
    neighborhood: null, instagram: null, emailVerified: true, partnerId: null,
    totpSecret: 'enc(PLAINSECRET)', totpEnabled: true, tokenVersion: 0, lastUsedTotpStep,
  })

  it('the same TOTP step verifies once; a replay inside the window is rejected and mints no session', async () => {
    const row = { lastUsedTotpStep: null as number | null }
    fakeStepClaim(row)
    p.user.findUnique.mockImplementation(async () => userRow(row.lastUsedTotpStep))

    const first = await verifyPOST(jsonReq('verify', 'POST', { code: '123456' }, await pendingCookie()))
    expect(first.status).toBe(200)
    expect(row.lastUsedTotpStep).toBe(STEP)
    expect(createSession).toHaveBeenCalledTimes(1)

    const replay = await verifyPOST(jsonReq('verify', 'POST', { code: '123456' }, await pendingCookie()))
    expect(replay.status).toBe(400)
    expect((await replay.json()).error).toMatch(/already used/)
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('never echoes the stored secret in the login response', async () => {
    fakeStepClaim({ lastUsedTotpStep: null })
    p.user.findUnique.mockResolvedValue(userRow(null))
    const res = await verifyPOST(jsonReq('verify', 'POST', { code: '123456' }, await pendingCookie()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).not.toHaveProperty('totpSecret')
    expect(body).not.toHaveProperty('lastUsedTotpStep')
    expect(JSON.stringify(body)).not.toContain('PLAINSECRET')
  })

  it('a backup code is looked up by its hash, never by the raw value', async () => {
    p.user.findUnique.mockResolvedValue(userRow(null))
    p.totpBackupCode.updateMany.mockResolvedValue({ count: 1 })
    const res = await verifyPOST(jsonReq('verify', 'POST', { code: 'abcde-fghjk' }, await pendingCookie()))
    expect(res.status).toBe(200)
    const where = p.totpBackupCode.updateMany.mock.calls[0][0].where
    expect(where.codeHash).toBe(createHash('sha256').update('ABCDEFGHJK').digest('hex'))
    expect(JSON.stringify(where).toUpperCase()).not.toContain('ABCDE')
    expect(where).toMatchObject({ userId: 'adm1', used: false })
    // Backup codes must not burn the TOTP step.
    expect(p.user.updateMany).not.toHaveBeenCalled()
    expect((await res.json()).usedBackupCode).toBe(true)
  })
})
