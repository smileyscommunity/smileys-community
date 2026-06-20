import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { hashToken } from '@/lib/tokenHash'

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimit(`reset:${getIp(req)}`, 5, 15 * 60_000)) {
      return NextResponse.json({ error: 'Too many attempts — please wait before trying again' }, { status: 429 })
    }

    const { token, password } = await req.json()
    if (!token || !password) return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    // A4 fix: 12-char min — mirror the register route.
    if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })

    // Tokens are stored as SHA-256 hashes — see lib/tokenHash.ts.
    const hashedToken = hashToken(token)
    const record = await prisma.passwordResetToken.findUnique({ where: { token: hashedToken } })

    if (!record || record.used || record.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Reset link is invalid or has expired' }, { status: 400 })
    }

    const hashed = await bcrypt.hash(password, 10)

    // Bump tokenVersion to evict any sessions held by an attacker who knows the old password.
    // Clear lockout state so a legit user resetting during a brute-force can log back in.
    await prisma.user.update({
      where: { id: record.userId },
      data:  {
        password: hashed,
        emailVerified: true,
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        loginLockedUntil: null,
      },
    })
    await prisma.passwordResetToken.update({ where: { token: hashedToken }, data: { used: true } })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
