import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { encryptTotpSecret, decryptTotpSecret } from '@/lib/totpCrypto'
import { generateSecret, generateURI, verifySync } from 'otplib/functional'
import QRCode from 'qrcode'

export async function GET() {
  const session = await getSession()
  // Both admins and moderators can enroll: moderators can review
  // applications + suspend users + read event chats, so PII access is
  // comparable. Members can't enroll (yet) — 2FA at login isn't surfaced
  // for the member role.
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { totpEnabled: true, email: true },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.totpEnabled) return NextResponse.json({ error: 'Already enabled' }, { status: 400 })

  const secret = generateSecret()
  // Encrypt at rest — see lib/totpCrypto.ts. DB leak of `totpSecret` column
  // alone no longer yields a working seed.
  await prisma.user.update({
    where: { id: session.id },
    data:  { totpSecret: encryptTotpSecret(secret) },
  })

  const otpauth = generateURI({ label: user.email, issuer: 'Smileys Community', secret, strategy: 'totp' } as any)
  const qrDataUrl = await QRCode.toDataURL(otpauth)

  return NextResponse.json({ qrDataUrl })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  // Both admins and moderators can enroll: moderators can review
  // applications + suspend users + read event chats, so PII access is
  // comparable. Members can't enroll (yet) — 2FA at login isn't surfaced
  // for the member role.
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 6-digit TOTP code is brute-forceable in minutes without a rate limit.
  // 5 attempts per 15 min per user — same cadence as the login-time verify
  // route (`2fa:<ip>`). Per-session.id rather than per-IP because the
  // attacker would already be authenticated with the user's password to
  // get here.
  if (!await rateLimit(`2fa-setup:${session.id}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { totpSecret: true, totpEnabled: true },
  })
  if (!user?.totpSecret) return NextResponse.json({ error: 'Run setup first' }, { status: 400 })
  if (user.totpEnabled) return NextResponse.json({ error: 'Already enabled' }, { status: 400 })

  const secret = decryptTotpSecret(user.totpSecret)
  const result = verifySync({ token: String(code), secret, strategy: 'totp' } as any)
  if (!(result as any).valid) return NextResponse.json({ error: 'Invalid code — try again' }, { status: 400 })

  await prisma.user.update({ where: { id: session.id }, data: { totpEnabled: true } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  // Both admins and moderators can enroll: moderators can review
  // applications + suspend users + read event chats, so PII access is
  // comparable. Members can't enroll (yet) — 2FA at login isn't surfaced
  // for the member role.
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Same rate limit shape as POST — disabling 2FA also requires a valid
  // code, so it's brute-forceable without the limit.
  if (!await rateLimit(`2fa-setup:${session.id}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { totpSecret: true, totpEnabled: true },
  })
  if (!user?.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
  }

  const secret = decryptTotpSecret(user.totpSecret)
  const result = verifySync({ token: String(code), secret, strategy: 'totp' } as any)
  if (!(result as any).valid) return NextResponse.json({ error: 'Invalid code' }, { status: 400 })

  await prisma.user.update({
    where: { id: session.id },
    data: { totpEnabled: false, totpSecret: null },
  })
  return NextResponse.json({ ok: true })
}
