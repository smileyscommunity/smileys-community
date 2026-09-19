import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { sendConfirmEmailChange, sendEmailChangeRequestedNotice, recordEmailFailure } from '@/lib/email'
import { rateLimit } from '@/lib/rateLimit'
import { hashToken } from '@/lib/tokenHash'
import { verifySync } from 'otplib/functional'
import { decryptTotpSecret } from '@/lib/totpCrypto'
import { writeAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`update-email:${session.id}`, 3, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
    }

    const { email, password, code } = await req.json()
    if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    if (!password) return NextResponse.json({ error: 'Password confirmation is required' }, { status: 400 })

    // Require password confirmation so a stolen session can't silently change email
    const user = await prisma.user.findUnique({ where: { id: session.id } })
    if (!user || !user.password) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return NextResponse.json({ error: 'Password is incorrect' }, { status: 401 })

    // 2FA-enrolled accounts must also present a fresh TOTP code — a stolen
    // session plus the password alone must not be able to rotate the login
    // email out from under the owner. 'code_required' is a machine-readable
    // marker: the settings form reveals its code input on seeing it.
    if (user.totpEnabled && user.totpSecret) {
      const codeStr = String(code ?? '').trim()
      if (!/^\d{6}$/.test(codeStr)) {
        return NextResponse.json({ error: 'code_required' }, { status: 400 })
      }
      const secret = decryptTotpSecret(user.totpSecret)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = verifySync({ token: codeStr, secret, strategy: 'totp' } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(result as any).valid) {
        return NextResponse.json({ error: 'Invalid code — check your authenticator app' }, { status: 400 })
      }
      // Same atomic step claim as /2fa/verify: a code observed at login must
      // not also rotate the email within its 30s window.
      const currentStep = Math.floor(Date.now() / 30000)
      const stepClaim = await prisma.user.updateMany({
        where: { id: user.id, OR: [{ lastUsedTotpStep: null }, { lastUsedTotpStep: { lt: currentStep } }] },
        data:  { lastUsedTotpStep: currentStep },
      })
      if (stepClaim.count !== 1) {
        return NextResponse.json({ error: 'This code was already used — wait for the next one.' }, { status: 400 })
      }
    }

    const newEmail = email.toLowerCase().trim()
    if (newEmail === user.email.toLowerCase()) return NextResponse.json({ error: 'That is already your email' }, { status: 400 })

    const existing = await prisma.user.findUnique({ where: { email: newEmail } })
    if (existing) return NextResponse.json({ error: 'Email already in use' }, { status: 409 })

    // The change waits for the new address to prove itself. It used to
    // switch the login on the spot and mark it unverified, so one typo moved
    // the account to an inbox nobody owned — and the password reset that
    // could have recovered it went there too. Now the account keeps its
    // address until the link sent to the new one is clicked (verify-email
    // applies it). Any earlier pending change is replaced.
    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24)
    await prisma.$transaction([
      prisma.emailVerificationToken.deleteMany({ where: { userId: session.id, newEmail: { not: null } } }),
      prisma.emailVerificationToken.create({ data: { userId: session.id, token: hashToken(token), expiresAt, newEmail, tokenVersion: user.tokenVersion } }),
    ])
    await writeAudit(session.id, session.name, 'user.email_change_requested', session.id, 'user',
      { from: user.email, to: newEmail, self: true },
      `${session.name} asked to change their email`,
    )
    // The confirmation is awaited: if it can't be sent, the member has to
    // know, or they'd wait for a link that never comes. The notice to the
    // current address is fire-and-forget.
    try {
      await sendConfirmEmailChange(newEmail, session.name, token)
    } catch (err) {
      await recordEmailFailure({ helper: 'sendConfirmEmailChange', recipient: newEmail, error: err, context: { userId: session.id } })
      return NextResponse.json({ error: "We couldn't send the confirmation email just now. Please try again in a few minutes." }, { status: 502 })
    }
    sendEmailChangeRequestedNotice(user.email, session.name, newEmail).catch(async err => {
      console.error('[update-email] change notice failed', { userId: session.id, err: String(err) })
      await recordEmailFailure({ helper: 'sendEmailChangeRequestedNotice', recipient: user.email, error: err, context: { userId: session.id } })
    })

    return NextResponse.json({ ok: true, pending: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
