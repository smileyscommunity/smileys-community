import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getSession, createSession } from '@/lib/session'
import { sendVerificationEmail } from '@/lib/email'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { hashToken } from '@/lib/tokenHash'

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`update-email:${session.id}`, 3, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
    }

    const { email, password } = await req.json()
    if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    if (!password) return NextResponse.json({ error: 'Password confirmation is required' }, { status: 400 })

    // Require password confirmation so a stolen session can't silently change email
    const user = await prisma.user.findUnique({ where: { id: session.id } })
    if (!user || !user.password) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return NextResponse.json({ error: 'Password is incorrect' }, { status: 401 })

    const newEmail = email.toLowerCase().trim()
    if (newEmail === session.email) return NextResponse.json({ error: 'That is already your email' }, { status: 400 })

    const existing = await prisma.user.findUnique({ where: { email: newEmail } })
    if (existing) return NextResponse.json({ error: 'Email already in use' }, { status: 409 })

    // Send verification to new email — generate the token before the
    // transaction so we can include both the email-change verification
    // setup AND the session rotation in a single atomic step. See the
    // change-password route for the same reasoning.
    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24)
    const hashedToken = hashToken(token)

    const { tokenVersion, newSessionId } = await prisma.$transaction(async tx => {
      const u = await tx.user.update({
        where: { id: session.id },
        // Bump tokenVersion so a stolen JWT can't keep using the account.
        data:  { email: newEmail, emailVerified: false, tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      })
      await tx.emailVerificationToken.deleteMany({ where: { userId: session.id } })
      await tx.emailVerificationToken.create({ data: { userId: session.id, token: hashedToken, expiresAt } })
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
    // Fire-and-forget mail send AFTER the tx commits — slow SMTP shouldn't
    // hold a DB transaction open.
    sendVerificationEmail(newEmail, session.name, token).catch(console.error)

    // Re-issue the JWT cookie pointing at the freshly-created Session row.
    await createSession(
      { ...session, email: newEmail, emailVerified: false, tokenVersion },
      { reuseSessionId: newSessionId },
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
