import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'

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

  const record = await prisma.passwordResetToken.findUnique({ where: { token } })

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
    if (password.length < 12) return NextResponse.json({ error: 'Password must be at least 12 characters' }, { status: 400 })

    const record = await prisma.passwordResetToken.findUnique({ where: { token } })

    if (!record || record.used || record.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This activation link is invalid or has expired.' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { id: record.userId }, select: { password: true } })
    if (!existing) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    if (existing.password) {
      return NextResponse.json({ error: 'This account has already been activated.' }, { status: 400 })
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

    await prisma.passwordResetToken.update({ where: { token }, data: { used: true } })

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
    })

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
