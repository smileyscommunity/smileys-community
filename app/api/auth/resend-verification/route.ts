import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendFinishRegistrationEmail } from '@/lib/email'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { hashToken } from '@/lib/tokenHash'

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimit(`resend-verify:${getIp(req)}`, 3, 10 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
    }

    const { email } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    // Always return ok to prevent email enumeration. password==null means a
    // never-activated applicant row — their pending ACTIVATION link is a
    // passwordResetToken too, and the deleteMany below would kill it while
    // this flow can't finish their activation (it never sets
    // status='approved'). Those accounts are served by the activation /
    // resend-approval flows instead.
    if (!user || user.emailVerified || !user.password) return NextResponse.json({ ok: true })

    // Rides the reset flow, not a plain verify link. This endpoint takes a
    // bare email, so anyone could re-arm a plain-verify token for an
    // unverified account — and a plain verify click activates whatever
    // password sits on the row (possibly a squatter's; see the register
    // route's unverified-duplicate branch). The finish link both verifies
    // AND replaces the password, so only the inbox owner ends up in
    // control. Email plaintext, store hash — see lib/tokenHash.ts.
    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24)
    await prisma.$transaction([
      prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      prisma.passwordResetToken.create({ data: { userId: user.id, token: hashToken(token), expiresAt } }),
    ])

    sendFinishRegistrationEmail(user.email, user.name, token).catch(console.error)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
