import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { encryptTotpSecret, decryptTotpSecret } from '@/lib/totpCrypto'
import { generateBatch as generateBackupCodes, hashCode as hashBackupCode } from '@/lib/totpBackupCodes'
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

  // Rate limit the secret-generation path. Each GET runs generateSecret +
  // encryptTotpSecret + a DB write + a QR PNG render — without a limit an
  // attacker with a session cookie can spray GETs to amplify DB writes
  // and burn CPU.
  //
  // Its OWN bucket, deliberately. This used to share `2fa-setup:<id>` with
  // POST/DELETE, which made enrollment self-locking: GET is what the "Set
  // up" button calls (it renders the QR), so opening the panel, mistyping a
  // code and asking for a fresh QR spent 4 of the 5 attempts a 15-minute
  // window allows — and an admin who hasn't enrolled yet is pinned to
  // /admin/security by app/admin/layout.tsx with nowhere else to go, so the
  // 429 locked them out of the only action available to them. Rendering a QR
  // is not a guess at a secret, so it does not belong in the brute-force
  // budget; this cap exists only to bound DB writes and CPU.
  if (!await rateLimit(`2fa-setup-qr:${session.id}`, 15, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many setup attempts. Try again in a few minutes.' }, { status: 429 })
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

  // Return the plaintext secret too so the UI's "Can't scan? Enter manually"
  // fallback works. The page was already trying to read `data.secret` but
  // we never sent it — the manual-entry panel was always blank. The secret
  // is no more sensitive than the QR (which encodes the same seed) and is
  // only valid until the user either completes POST (which leaves
  // totpEnabled=true) or re-runs GET (which overwrites with a fresh seed).
  return NextResponse.json({ qrDataUrl, secret })
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
  //
  // Shares `2fa-setup:<id>` with DELETE on purpose: both accept a 6-digit
  // code, so giving them separate buckets would hand an attacker 10 guesses
  // per window instead of 5. GET is the one that was split out — see there.
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

  // Generate backup codes alongside enabling 2FA. The plaintext codes are
  // returned in this response ONCE — the user must save them somewhere
  // safe. We only store hashes; the plaintext is never retrievable again
  // (regenerating issues a fresh batch and nukes the old hashes).
  const backupCodes = generateBackupCodes()
  await prisma.$transaction([
    prisma.user.update({ where: { id: session.id }, data: { totpEnabled: true } }),
    // Defensive nuke of any stale codes from a previous enrollment.
    prisma.totpBackupCode.deleteMany({ where: { userId: session.id } }),
    prisma.totpBackupCode.createMany({
      data: backupCodes.map(c => ({ userId: session.id, codeHash: hashBackupCode(c) })),
    }),
  ])
  // Mark the current session as totpVerified so the user doesn't have to
  // log out and back in — they just proved possession of the TOTP device.
  if (session.sessionId) {
    await prisma.session.update({
      where: { id: session.sessionId },
      data:  { totpVerified: true },
    })
  }
  return NextResponse.json({ ok: true, backupCodes })
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

  // Same bucket as POST, not merely the same shape — disabling 2FA also
  // takes a valid code, and one shared budget is what stops an attacker
  // alternating POST and DELETE to double their guesses per window.
  if (!await rateLimit(`2fa-setup:${session.id}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { totpSecret: true, totpEnabled: true, lastUsedTotpStep: true },
  })
  if (!user?.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
  }

  const secret = decryptTotpSecret(user.totpSecret)
  const result = verifySync({ token: String(code), secret, strategy: 'totp' } as any)
  if (!(result as any).valid) return NextResponse.json({ error: 'Invalid code' }, { status: 400 })

  // Replay protection — same window as /verify. Without this, an attacker
  // with a stolen session cookie who shoulder-surfed one fresh TOTP code at
  // the user's screen could call /verify (which claims lastUsedTotpStep)
  // and then within the same 30s call DELETE with the SAME code to disable
  // 2FA entirely. Claimed atomically (guard-in-WHERE) — the old read-check
  // ran OUTSIDE the transaction below despite its comment, so two
  // concurrent requests could both pass it.
  const currentStep = Math.floor(Date.now() / 30000)
  const stepClaim = await prisma.user.updateMany({
    where: { id: session.id, OR: [{ lastUsedTotpStep: null }, { lastUsedTotpStep: { lt: currentStep } }] },
    data:  { lastUsedTotpStep: currentStep },
  })
  if (stepClaim.count !== 1) {
    return NextResponse.json({ error: 'This code was already used — wait for the next one.' }, { status: 400 })
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.id },
      data: { totpEnabled: false, totpSecret: null, lastUsedTotpStep: currentStep },
    }),
    // Nuke backup codes so they can't be used to log in after the user
    // has explicitly disabled 2FA.
    prisma.totpBackupCode.deleteMany({ where: { userId: session.id } }),
  ])
  return NextResponse.json({ ok: true })
}
