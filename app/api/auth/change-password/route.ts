import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getSession, createSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { totpReauth } from '@/lib/totpReauth'

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`change-password:${session.id}`, 5, 15 * 60_000)) {
      return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 })
    }

    const { currentPassword, newPassword, code } = await req.json()
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }
    // 8-char minimum — mirror the register route (owner's call, 2026-08-22).
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id: session.id } })
    if (!user || !user.password) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
    }

    // Same second proof the email change asks for: a stolen session plus a
    // reused password shouldn't be able to lock the owner out.
    const reauth = await totpReauth(user, code)
    if (reauth) return reauth

    const hashed = await bcrypt.hash(newPassword, 10)
    // Bump tokenVersion to evict all other sessions, nuke every Session
    // row for this user, and mint a fresh tracked row for the current
    // device — all in one transaction so a DB hiccup mid-flow can't leave
    // the user with a wiped session table but a stale JWT cookie. The
    // cookie itself is set OUTSIDE the transaction (it's an HTTP-header
    // operation); if it ever fails, the next request just sees a missing
    // cookie and prompts re-login, which is recoverable. Previously the
    // sequence was deleteMany then createSession without a tx wrapper,
    // so a transient throw on createSession's row insert orphaned every
    // session.
    const { tokenVersion, newSessionId } = await prisma.$transaction(async tx => {
      const u = await tx.user.update({
        where: { id: session.id },
        data:  {
          password: hashed,
          tokenVersion: { increment: 1 },
          failedLoginCount: 0,
          loginLockedUntil: null,
        },
        select: { tokenVersion: true },
      })
      await tx.session.deleteMany({ where: { userId: session.id } })
      // Every device is signed out, so no device keeps its push: a revoked
      // phone went on receiving notifications (message previews included).
      await tx.pushSubscription.deleteMany({ where: { userId: session.id } })
      // Outstanding links die with the old password. Our own warning emails
      // tell a member who suspects trouble to change their password — and a
      // reset link someone else asked for used to survive that and hand them
      // the account minutes later. A pending email change goes too (it is
      // already refused at the old tokenVersion; this clears the row).
      await tx.passwordResetToken.deleteMany({ where: { userId: session.id } })
      // Only the pending email CHANGE. The same table holds the signup
      // "verify your email" token, which carries no version and is still
      // clickable — clearing it left a new member unverified with no link.
      await tx.emailVerificationToken.deleteMany({ where: { userId: session.id, newEmail: { not: null } } })
      const row = await tx.session.create({
        data: {
          userId:    session.id,
          userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
          ip:        getIp(req),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          // Carried onto the new row: createSession's reuse path only slides
          // the expiry, so an admin who changed their password silently lost
          // step-up (the comment below said otherwise) and would be locked
          // out of the 2FA-gated operations until re-login.
          totpVerified: session.totpVerified ?? false,
        },
        select: { id: true },
      })
      return { tokenVersion: u.tokenVersion, newSessionId: row.id }
    })
    // Re-issue the JWT/cookie pointing at the freshly-created Session row.
    // totpVerified carries forward — minting it as false here would demote a
    // 2FA-verified session on every password change (isAdminStrict's signal).
    await createSession(
      { ...session, tokenVersion },
      { reuseSessionId: newSessionId, totpVerified: session.totpVerified },
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
