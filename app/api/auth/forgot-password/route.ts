import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendPasswordResetEmail, sendNewActivationLinkEmail } from '@/lib/email'
import { issueActivationToken } from '@/lib/activation'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'
import { hashToken } from '@/lib/tokenHash'

export async function POST(req: NextRequest) {
  try {
    // 5 requests per 10 minutes per IP
    if (!await rateLimit(`forgot:${getIp(req)}`, 5, 10 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
    }

    const { email, _cf } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

    if (!(await verifyTurnstile(_cf ?? '', getIp(req)))) {
      return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

    // Always return success to prevent email enumeration
    if (!user) return NextResponse.json({ ok: true })

    // An account with no password was never activated. For an approved
    // member that is the most likely reason they are here: the activation
    // link died after 7 days and "forgot password" is the obvious next try.
    // It used to return ok and send nothing — a silent dead end. Anyone else
    // without a password (pending, suspended) still gets the silent ok.
    if (!user.password) {
      // Same per-account budget as /activate/resend (they share the key):
      // each call invalidates the link the member is holding, so an
      // unthrottled path let anyone who knew the email keep it dead and
      // fill the inbox. Silent ok when throttled — no enumeration.
      if (user.status === 'approved' && await rateLimit(`activate-resend-user:${user.id}`, 1, 15 * 60_000)) {
        const token = await issueActivationToken(user.id)
        await sendNewActivationLinkEmail(user.email, user.name, token)
      }
      return NextResponse.json({ ok: true })
    }

    // Invalidate old tokens
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })

    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60) // 1 hour

    // Email the plaintext, store the SHA-256 hash. See lib/tokenHash.ts.
    await prisma.passwordResetToken.create({ data: { userId: user.id, token: hashToken(token), expiresAt } })

    await sendPasswordResetEmail(user.email, user.name, token)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
