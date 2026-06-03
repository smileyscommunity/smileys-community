import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getSession, createSession } from '@/lib/session'
import { sendVerificationEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rateLimit'
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

    // Bump tokenVersion so an attacker holding a stolen JWT can't keep using the account.
    const updated = await prisma.user.update({
      where: { id: session.id },
      data:  { email: newEmail, emailVerified: false, tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    })

    // Send verification to new email
    await prisma.emailVerificationToken.deleteMany({ where: { userId: session.id } })
    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24)
    // Email plaintext, store hash — see lib/tokenHash.ts.
    await prisma.emailVerificationToken.create({ data: { userId: session.id, token: hashToken(token), expiresAt } })
    sendVerificationEmail(newEmail, session.name, token).catch(console.error)

    // Same shape as change-password: nuke every existing Session row
    // (consistent with the tokenVersion bump that invalidates every JWT),
    // then issue a fresh one for this device so it stays signed in.
    await prisma.session.deleteMany({ where: { userId: session.id } })
    await createSession(
      { ...session, email: newEmail, emailVerified: false, tokenVersion: updated.tokenVersion },
      { userAgent: req.headers.get('user-agent') },
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
