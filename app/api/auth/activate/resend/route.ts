import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { hashToken } from '@/lib/tokenHash'
import { issueActivationToken, maskEmail } from '@/lib/activation'
import { sendNewActivationLinkEmail } from '@/lib/email'

// "Send me a new link" on the expired-activation page. The old token is the
// proof of possession: it came from the member's inbox, so no Turnstile and
// no email field — one tap. The lookup works on an expired token because
// expiry is a date check, not a deletion. The account must still be one that
// can activate: approved, and no password set. Anything else gets the same
// generic answer, so this can't be used to probe accounts.

export async function POST(req: NextRequest) {
  try {
    if (!await rateLimit(`activate-resend:${getIp(req)}`, 5, 10 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
    }
    const { token } = await req.json().catch(() => ({}))
    if (typeof token !== 'string' || !token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    const record = await prisma.passwordResetToken.findUnique({ where: { token: hashToken(token) } })
    if (!record || record.used) {
      return NextResponse.json({ error: 'This activation link is invalid.' }, { status: 400 })
    }
    const user = await prisma.user.findUnique({
      where:  { id: record.userId },
      select: { id: true, name: true, email: true, status: true, password: true },
    })
    if (!user || user.status !== 'approved' || user.password) {
      return NextResponse.json({ error: 'This account cannot be activated with this link.' }, { status: 400 })
    }
    // One fresh link per quarter hour per account: the button is a tap away.
    if (!await rateLimit(`activate-resend-user:${user.id}`, 1, 15 * 60_000)) {
      return NextResponse.json({ error: 'A new link was sent recently — check your inbox, including spam.' }, { status: 429 })
    }

    const fresh = await issueActivationToken(user.id)
    await sendNewActivationLinkEmail(user.email, user.name, fresh)
    return NextResponse.json({ ok: true, email: maskEmail(user.email) })
  } catch (e) {
    console.error('[activate/resend]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
