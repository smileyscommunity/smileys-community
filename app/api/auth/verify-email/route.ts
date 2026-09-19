import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { hashToken } from '@/lib/tokenHash'
import { getSession, createSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { sendEmailChangedNotice, recordEmailFailure } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimit(`verify-email:${getIp(req)}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { token } = await req.json()
    if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 })

    // Tokens are stored as SHA-256 hashes — see lib/tokenHash.ts.
    const hashed = hashToken(token)
    const record = await prisma.emailVerificationToken.findUnique({ where: { token: hashed } })

    if (!record || record.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Verification link is invalid or has expired' }, { status: 400 })
    }

    if (record.newEmail) return applyEmailChange(record.userId, record.newEmail, record.tokenVersion, hashed)

    await prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } })
    await prisma.emailVerificationToken.delete({ where: { token: hashed } })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// The second half of a login-email change (api/auth/update-email): the new
// address has proven itself by clicking, so the account moves to it now.
async function applyEmailChange(userId: string, newEmail: string, askedAtVersion: number | null, hashed: string) {
  // Read before the tokenVersion bump below — afterwards getSession() sees
  // the old version and signs this browser out.
  const session = await getSession().catch(() => null)
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { email: true, name: true, status: true, suspendedUntil: true, tokenVersion: true },
  })
  // Dead if the account was signed out everywhere since it was asked for
  // (password changed or reset, ban, role change), or is banned or
  // suspended now.
  if (!user || user.status === 'banned' || (user.suspendedUntil && user.suspendedUntil > new Date()) ||
      askedAtVersion === null || askedAtVersion !== user.tokenVersion) {
    await prisma.emailVerificationToken.delete({ where: { token: hashed } }).catch(() => {})
    return NextResponse.json({ error: 'Verification link is invalid or has expired' }, { status: 400 })
  }
  // Someone may have registered the address in the day since.
  const taken = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } })
  if (taken && taken.id !== userId) {
    await prisma.emailVerificationToken.delete({ where: { token: hashed } }).catch(() => {})
    return NextResponse.json({ error: 'That email is already in use by another account' }, { status: 409 })
  }

  let tokenVersion: number
  try {
    const u = await prisma.$transaction(async tx => {
      const updated = await tx.user.update({
        // Still at the version it was asked at — a sign-out-everywhere racing
        // this click makes it miss (P2025) rather than land.
        where: { id: userId, tokenVersion: askedAtVersion },
        // Bump tokenVersion: every device signed in before the change signs in
        // again, so a session someone else held doesn't outlive it.
        data:  { email: newEmail, emailVerified: true, tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      })
      // Applications are keyed by email, not userId. Left on the old address
      // the row looks like a departed member's (the orphan scrub erased six
      // live members' applications that way on 2026-09-14) and self-deletion
      // can no longer find it to scrub. Moves with the address, atomically.
      await tx.memberApplication.updateMany({
        where: { email: { equals: user.email, mode: 'insensitive' } },
        data:  { email: newEmail },
      })
      await tx.emailVerificationToken.deleteMany({ where: { userId } })
      // A reset link issued to the OLD address would still work after the
      // login moved — and the notice we send there names the new address.
      await tx.passwordResetToken.deleteMany({ where: { userId } })
      return updated
    })
    tokenVersion = u.tokenVersion
  } catch (e) {
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null
    // Registered by someone else between the check above and this write.
    if (code === 'P2002') return NextResponse.json({ error: 'That email is already in use by another account' }, { status: 409 })
    if (code === 'P2025') return NextResponse.json({ error: 'Verification link is invalid or has expired' }, { status: 400 })
    throw e
  }
  // The trail self-deletion reads to find applications still filed under an
  // earlier address — same action and meta shape as the admin email edit.
  await writeAudit(userId, user.name, 'user.email_change', userId, 'user',
    { from: user.email, to: newEmail, self: true },
    `${user.name} changed their own email`,
  )
  sendEmailChangedNotice(user.email, user.name, newEmail).catch(async err => {
    console.error('[verify-email] change notice failed', { userId, err: String(err) })
    await recordEmailFailure({ helper: 'sendEmailChangedNotice', recipient: user.email, error: err, context: { userId } })
  })

  // Clicked in the browser that's signed in to this account: keep it signed
  // in under the new version. Anyone else (another device, another account)
  // just gets the confirmation.
  if (session && session.id === userId && session.sessionId) {
    await createSession(
      { ...session, email: newEmail, emailVerified: true, tokenVersion },
      { reuseSessionId: session.sessionId, totpVerified: session.totpVerified },
    ).catch(() => {})
  }
  return NextResponse.json({ ok: true, emailChanged: true })
}
