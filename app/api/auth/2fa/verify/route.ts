import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { jwtVerify } from 'jose'
import { verifySync } from 'otplib/functional'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { decryptTotpSecret } from '@/lib/totpCrypto'
import { hashCode as hashBackupCode } from '@/lib/totpBackupCodes'
import { hostCityIds } from '@/lib/access'

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
  //
  // Normalize whitespace + ASCII hyphen BEFORE classifying so an iOS paste
  // with an interior NBSP (system-inserted) or a copy from a hyphenated
  // backup-code display doesn't misroute. hashBackupCode also normalizes,
  // so the cleaned form is what we hand to both verifiers.
  const codeStr = String(code).replace(/[\s-]/g, '')
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
    // Atomic claim (guard-in-WHERE), same pattern as the backup-code path
    // below — the old read-check with the bump deferred to the end of the
    // handler let two concurrent verifies replaying one observed code both
    // pass the check before either bumped the step.
    const stepClaim = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastUsedTotpStep: null }, { lastUsedTotpStep: { lt: currentStep } }] },
      data:  { lastUsedTotpStep: currentStep },
    })
    if (stepClaim.count !== 1) {
      return NextResponse.json({ error: 'This code was already used — wait for the next one.' }, { status: 400 })
    }
  } else {
    // Backup-code path. Atomic claim: updateMany only flips rows where
    // used=false AND userId matches, returning the count. Two concurrent
    // requests with the same code see exactly one count===1 winner; the
    // other gets count===0 and is rejected. The previous findUnique +
    // update was a TOCTOU race that could mint two sessions from one code.
    const hashed = hashBackupCode(codeStr)
    const claim = await prisma.totpBackupCode.updateMany({
      where: { codeHash: hashed, userId: user.id, used: false },
      data:  { used: true, usedAt: new Date() },
    })
    if (claim.count !== 1) {
      return NextResponse.json({ error: 'Invalid code — check your authenticator app' }, { status: 400 })
    }
    usedBackupCode = true
  }

  const [isClubHost, cityIds] = await Promise.all([
    prisma.clubMembership.count({
      where: { userId: user.id, status: 'approved', role: 'host' },
    }).then(c => c > 0),
    // City-level hosting authority — same payload field the /host gates read.
    hostCityIds(user.id),
  ])

  const initials = user.name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

  // lastUsedTotpStep was already claimed atomically above for the TOTP
  // path (and deliberately untouched for backup codes — bumping it there
  // would block the user's next legitimate TOTP code).
  const userUpdate = { lastActive: new Date() }

  const [, , remainingBackupCodes] = await Promise.all([
    createSession(
      { id: user.id, name: user.name, email: user.email, role: user.role,
        color: user.color, partnerId: user.partnerId || undefined, tokenVersion: user.tokenVersion },
      { userAgent: req.headers.get('user-agent'), ip: getIp(req), totpVerified: true },
    ),
    prisma.user.update({ where: { id: user.id }, data: userUpdate }),
    prisma.totpBackupCode.count({ where: { userId: user.id, used: false } }),
  ])

  const res = NextResponse.json({
    id: user.id, name: user.name, email: user.email, role: user.role,
    color: user.color, initials, bio: user.bio, neighborhood: user.neighborhood,
    instagram: user.instagram, emailVerified: user.emailVerified, isClubHost, hostCityIds: cityIds,
    partnerId: user.partnerId, totpEnabled: true,
    // UI uses these to warn after a backup-code login: "You just used a
    // recovery code. N remain. Regenerate at /settings/2fa."
    usedBackupCode,
    remainingBackupCodes,
  })
  // Same attributes login used to set it (httpOnly/secure/sameSite), or
  // Safari declines to overwrite the Secure original and the pending-2FA
  // cookie outlives the verification it was for.
  res.cookies.set('smileys_2fa_pending', '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   0,
    path:     '/',
  })
  return res
}
