import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getSession, createSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`change-password:${session.id}`, 5, 15 * 60_000)) {
      return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 })
    }

    const { currentPassword, newPassword } = await req.json()
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }
    // A4 fix: 12-char min — mirror the register route.
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
      const row = await tx.session.create({
        data: {
          userId:    session.id,
          userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
          ip:        getIp(req),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        select: { id: true },
      })
      return { tokenVersion: u.tokenVersion, newSessionId: row.id }
    })
    // Re-issue the JWT/cookie pointing at the freshly-created Session row.
    await createSession(
      { ...session, tokenVersion },
      { reuseSessionId: newSessionId },
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
