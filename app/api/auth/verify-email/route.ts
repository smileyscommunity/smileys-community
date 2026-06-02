import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { hashToken } from '@/lib/tokenHash'

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

    await prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } })
    await prisma.emailVerificationToken.delete({ where: { token: hashed } })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
