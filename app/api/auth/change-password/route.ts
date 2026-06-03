import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getSession, createSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

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
    if (newPassword.length < 12) {
      return NextResponse.json({ error: 'New password must be at least 12 characters' }, { status: 400 })
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
    // Bump tokenVersion to evict all other sessions; re-issue cookie for this device.
    // Also reset lockout state so a legit user mid-attack isn't locked out by stale counters.
    const updated = await prisma.user.update({
      where: { id: session.id },
      data:  {
        password: hashed,
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        loginLockedUntil: null,
      },
      select: { tokenVersion: true },
    })
    // Nuke every active Session row for this user (including this device's),
    // then issue a brand new one — consistent with the tokenVersion bump that
    // invalidates every existing JWT. Other devices now lose their /settings
    // entry too; this device gets a fresh JWT immediately so it stays signed
    // in.
    await prisma.session.deleteMany({ where: { userId: session.id } })
    await createSession(
      { ...session, tokenVersion: updated.tokenVersion },
      { userAgent: req.headers.get('user-agent') },
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
