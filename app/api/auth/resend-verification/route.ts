import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail } from '@/lib/email'
import { rateLimit, getIp } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimit(`resend-verify:${getIp(req)}`, 3, 10 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
    }

    const { email } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    // Always return ok to prevent email enumeration
    if (!user || user.emailVerified) return NextResponse.json({ ok: true })

    await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } })

    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24)
    await prisma.emailVerificationToken.create({ data: { userId: user.id, token, expiresAt } })

    sendVerificationEmail(user.email, user.name, token).catch(console.error)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
