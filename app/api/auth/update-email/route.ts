import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { sendConfirmEmailChange, sendEmailChangeRequestedNotice, recordEmailFailure } from '@/lib/email'
import { rateLimit } from '@/lib/rateLimit'
import { hashToken } from '@/lib/tokenHash'
import { totpReauth } from '@/lib/totpReauth'
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

    const newEmail = email.toLowerCase().trim()
    if (newEmail === user.email.toLowerCase()) return NextResponse.json({ error: 'That is already your email' }, { status: 400 })

    // Checked here, not by the mail service: an address like "nate@" used to
    // write a token row, fail at send time, and come back as "we couldn't
    // send it just now" — which was false, and it spent one of three
    // attempts an hour and dropped any earlier pending change.
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(newEmail) || newEmail.length > 200) {
      return NextResponse.json({ error: "That doesn't look like an email address" }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email: newEmail } })
    if (existing) return NextResponse.json({ error: 'Email already in use' }, { status: 409 })

    // Last, so a rejected address doesn't burn the member's 30-second code.
    const reauth = await totpReauth(user, code)
    if (reauth) return reauth

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

// GET — the change waiting for the new address to confirm, if any. Settings
// showed nothing at all, so a member who mistyped the address had no way to
// see what they'd asked for, and no way to take it back.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  // Matched against the account's current tokenVersion: the link is refused
  // at any other one (verify-email), so a change left behind by a password
  // change or a "sign out everywhere" isn't pending — it's dead, and saying
  // otherwise leaves the page waiting for a confirmation that can't work.
  const [row, user] = await Promise.all([
    prisma.emailVerificationToken.findFirst({
      where:  { userId: session.id, newEmail: { not: null }, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
      select: { newEmail: true, expiresAt: true, tokenVersion: true },
    }),
    prisma.user.findUnique({ where: { id: session.id }, select: { tokenVersion: true } }),
  ])
  const live = row && user && row.tokenVersion === user.tokenVersion
  return NextResponse.json({ pending: live ? { newEmail: row.newEmail, expiresAt: row.expiresAt } : null })
}

// DELETE — cancel it. No password: this only ever un-does a request, and the
// address it would have moved to is the one at risk if it stands.
export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`update-email-cancel:${session.id}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { count } = await prisma.emailVerificationToken.deleteMany({
    where: { userId: session.id, newEmail: { not: null } },
  })
  return NextResponse.json({ ok: true, cancelled: count > 0 })
}
