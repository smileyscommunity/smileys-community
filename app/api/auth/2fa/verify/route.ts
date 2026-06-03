import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { jwtVerify } from 'jose'
import { verifySync } from 'otplib/functional'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { decryptTotpSecret } from '@/lib/totpCrypto'
import { hashCode as hashBackupCode } from '@/lib/totpBackupCodes'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

export async function POST(req: NextRequest) {
  if (!await rateLimit(`2fa:${getIp(req)}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const pending = req.cookies.get('smileys_2fa_pending')?.value
  if (!pending) return NextResponse.json({ error: 'Session expired — please log in again' }, { status: 401 })

  let userId: string
  try {
    const { payload } = await jwtVerify(pending, SECRET)
    if (!payload.pending2fa || typeof payload.userId !== 'string') throw new Error()
    userId = payload.userId
  } catch {
    return NextResponse.json({ error: 'Session expired — please log in again' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, color: true, bio: true,
              neighborhood: true, instagram: true, emailVerified: true, partnerId: true,
              totpSecret: true, totpEnabled: true, tokenVersion: true, lastUsedTotpStep: true },
  })
  if (!user?.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: 'Session expired — please log in again' }, { status: 401 })
  }

  // Two acceptance paths: a 6-digit TOTP code, or a one-time backup code.
  // The backup-code path is for users who've lost their phone — each code
  // is single-use, hash-stored, and marked `used` on consumption.
  const codeStr = String(code).trim()
  const looksLikeTotp = /^\d{6}$/.test(codeStr)

  let usedBackupCode = false
  const currentStep = Math.floor(Date.now() / 30000)

  if (looksLikeTotp) {
    const secret = decryptTotpSecret(user.totpSecret)
    const result = verifySync({ token: codeStr, secret, strategy: 'totp' } as any)
    if (!(result as any).valid) {
      return NextResponse.json({ error: 'Invalid code — check your authenticator app' }, { status: 400 })
    }
    // Block replay of the same TOTP code within its 30s validity window.
    if (user.lastUsedTotpStep !== null && currentStep <= user.lastUsedTotpStep) {
      return NextResponse.json({ error: 'This code was already used — wait for the next one.' }, { status: 400 })
    }
  } else {
    // Backup-code path. Look up by hash; only accept if not yet used.
    const hashed = hashBackupCode(codeStr)
    const backup = await prisma.totpBackupCode.findUnique({
      where: { codeHash: hashed },
      select: { id: true, userId: true, used: true },
    })
    if (!backup || backup.userId !== user.id || backup.used) {
      return NextResponse.json({ error: 'Invalid code — check your authenticator app' }, { status: 400 })
    }
    await prisma.totpBackupCode.update({
      where: { id: backup.id },
      data:  { used: true, usedAt: new Date() },
    })
    usedBackupCode = true
  }

  const isClubHost = await prisma.clubMembership.count({
    where: { userId: user.id, status: 'approved', role: 'host' },
  }) > 0

  const initials = user.name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

  // Only bump lastUsedTotpStep if a TOTP code was actually used — otherwise
  // a backup-code login would block the user's next legitimate TOTP code.
  const userUpdate = usedBackupCode
    ? { lastActive: new Date() }
    : { lastActive: new Date(), lastUsedTotpStep: currentStep }

  const [, , remainingBackupCodes] = await Promise.all([
    createSession(
      { id: user.id, name: user.name, email: user.email, role: user.role,
        color: user.color, partnerId: user.partnerId || undefined, tokenVersion: user.tokenVersion },
      { userAgent: req.headers.get('user-agent'), ip: getIp(req) },
    ),
    prisma.user.update({ where: { id: user.id }, data: userUpdate }),
    prisma.totpBackupCode.count({ where: { userId: user.id, used: false } }),
  ])

  const res = NextResponse.json({
    id: user.id, name: user.name, email: user.email, role: user.role,
    color: user.color, initials, bio: user.bio, neighborhood: user.neighborhood,
    instagram: user.instagram, emailVerified: user.emailVerified, isClubHost,
    partnerId: user.partnerId,
    // UI uses these to warn after a backup-code login: "You just used a
    // recovery code. N remain. Regenerate at /settings/2fa."
    usedBackupCode,
    remainingBackupCodes,
  })
  res.cookies.set('smileys_2fa_pending', '', { maxAge: 0, path: '/' })
  return res
}
