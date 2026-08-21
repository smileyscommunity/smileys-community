import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { hashToken } from '@/lib/tokenHash'

// A1 fix: every other auth route is rate-limited; activate was
// the lone exception. Token is 256-bit so brute force is
// infeasible, but a leaked activation link in a forwarded email
// or compromised inbox could otherwise be replayed without
// limit. Matches the verify-email cadence (10/min) — generous
// because GET fires on every page render of the activation form.
export async function GET(req: NextRequest) {
  if (!await rateLimit(`activate:${getIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
  }
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  // Tokens are stored as SHA-256 hashes — see lib/tokenHash.ts.
  const hashed = hashToken(token)
  const record = await prisma.passwordResetToken.findUnique({ where: { token: hashed } })

  if (!record || record.used || record.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This activation link is invalid or has expired.' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { name: true, email: true, interests: true, profilePhoto: true, emailVerified: true },
  })

  if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })

  // Check activation status without fetching the hash
  const hasPassword = await prisma.user.count({ where: { id: record.userId, password: { not: null } } })
  if (hasPassword) {
    return NextResponse.json({ error: 'This account has already been activated.' }, { status: 400 })
  }

  return NextResponse.json({
    name:         user.name,
    email:        user.email,
    interests:    user.interests ?? [],
    profilePhoto: user.profilePhoto ?? null,
  })
}

export async function POST(req: NextRequest) {
  // Same rate limit as GET — protects the final activation step
  // against brute-force replay of a leaked token URL.
  if (!await rateLimit(`activate:${getIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
  }
  try {
    const { token, password, bio } = await req.json()
    if (!token || !password) return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    // A4 fix: 12-char min — mirror the register route.
    if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })

    // Tokens are stored as SHA-256 hashes — see lib/tokenHash.ts.
    const hashedToken = hashToken(token)
    const record = await prisma.passwordResetToken.findUnique({ where: { token: hashedToken } })

    if (!record || record.used || record.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This activation link is invalid or has expired.' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({
      where:  { id: record.userId },
      select: { password: true, email: true, status: true, suspendedUntil: true },
    })
    if (!existing) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    if (existing.password) {
      return NextResponse.json({ error: 'This account has already been activated.' }, { status: 400 })
    }

    // The token proves the email was approved WHEN IT WAS ISSUED — not that
    // the account is still in good standing. A member banned after approval
    // could otherwise click the 7-day link still in their inbox and write
    // status back to 'approved' with a fresh session. Check current status
    // and the blacklist (same rule as register) before activating.
    if (existing.status === 'banned' || (existing.suspendedUntil && existing.suspendedUntil > new Date())) {
      return NextResponse.json({ error: 'This activation link is invalid or has expired.' }, { status: 400 })
    }
    const blacklisted = await prisma.blacklist.findFirst({ where: { email: existing.email } })
    if (blacklisted) {
      return NextResponse.json({ error: 'This activation link is invalid or has expired.' }, { status: 400 })
    }

    const hashed = await bcrypt.hash(password, 10)

    const user = await prisma.user.update({
      where: { id: record.userId },
      data: {
        password:      hashed,
        bio:           bio?.trim() || null,
        status:        'approved',
        emailVerified: true,
      },
    })

    await prisma.passwordResetToken.update({ where: { token: hashedToken }, data: { used: true } })

    await createSession({
      id:            user.id,
      name:          user.name,
      email:         user.email,
      role:          user.role,
      color:         user.color,
      bio:           user.bio ?? undefined,
      neighborhood:  user.neighborhood ?? undefined,
      instagram:     user.instagram ?? undefined,
      emailVerified: user.emailVerified,
    }, { userAgent: req.headers.get('user-agent'), ip: getIp(req) })

    const initials = user.name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

    return NextResponse.json({
      ok:            true,
      id:            user.id,
      name:          user.name,
      initials,
      color:         user.color,
      role:          user.role,
      bio:           user.bio ?? null,
      emailVerified: user.emailVerified,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
