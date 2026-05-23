import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'
import { sendNewDeviceLoginEmail, sendAccountLockedEmail } from '@/lib/email'
import { sendPushToUser } from '@/lib/push'
import { SignJWT } from 'jose'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

// Cost-10 bcrypt hash used to equalize response time on non-existent emails,
// preventing user enumeration via timing analysis. The plaintext isn't a secret —
// it's never compared against real user passwords.
const TIMING_GUARD_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

export async function POST(req: NextRequest) {
  try {
    // 5 attempts per 15 minutes per IP
    if (!await rateLimit(`login:${getIp(req)}`, 5, 15 * 60_000)) {
      return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 })
    }

    const { email, password, _cf } = await req.json()

    if (!(await verifyTurnstile(_cf ?? '', getIp(req)))) {
      return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
    }

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() },
      select: { id: true, name: true, email: true, role: true, color: true, bio: true,
                neighborhood: true, instagram: true, emailVerified: true, partnerId: true,
                password: true, status: true, suspendedUntil: true, suspensionNote: true,
                totpEnabled: true, failedLoginCount: true, loginLockedUntil: true, knownIps: true,
                tokenVersion: true } })
    if (!user || !user.password) {
      // Burn equivalent CPU time so attackers can't distinguish "no such user"
      // from "wrong password" by measuring response latency.
      await bcrypt.compare(password, TIMING_GUARD_HASH)
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Account lockout check
    if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
      const until = user.loginLockedUntil.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      return NextResponse.json({ error: `Account locked due to too many failed attempts. Try again after ${until}.` }, { status: 429 })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      const newCount = (user.failedLoginCount ?? 0) + 1
      const lockUntil = newCount >= 10 ? new Date(Date.now() + 60 * 60_000) : null
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: newCount, loginLockedUntil: lockUntil ?? undefined },
      })
      if (newCount === 10) {
        sendAccountLockedEmail(user.email, user.name).catch(() => {})
      }
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Reset failed count on success
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, loginLockedUntil: null } })

    if (user.status === 'banned') {
      return NextResponse.json({ error: 'Your account has been suspended. Contact support if you believe this is an error.' }, { status: 403 })
    }

    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      const until = new Date(user.suspendedUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      return NextResponse.json({
        error: `Your account is temporarily suspended until ${until}. Reason: ${user.suspensionNote || 'Violation of guidelines'}`
      }, { status: 403 })
    }

    if (user.status === 'pending') {
      return NextResponse.json({ error: 'Your application is still pending review. You will receive an email once approved.' }, { status: 403 })
    }

    if (!user.emailVerified && user.role === 'member') {
      return NextResponse.json({ error: 'Please verify your email before logging in. Check your inbox for the verification link.' }, { status: 403 })
    }

    // 2FA required — issue a short-lived pending cookie instead of a full session
    if (user.totpEnabled) {
      const pendingToken = await new SignJWT({ userId: user.id, pending2fa: true })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('5m')
        .sign(SECRET)

      const res = NextResponse.json({ requires2FA: true })
      res.cookies.set('smileys_2fa_pending', pendingToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 5 * 60,
        path: '/',
      })
      return res
    }

    const initials = user.name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

    const isClubHost = await prisma.clubMembership.count({
      where: { userId: user.id, status: 'approved', role: 'host' },
    }) > 0

    // New device / IP detection
    const loginIp = getIp(req)
    const isNewIp  = loginIp && !(user.knownIps ?? []).includes(loginIp)
    if (isNewIp) {
      const loginTime = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' })
      sendNewDeviceLoginEmail(user.email, user.name, loginIp, `${loginTime} Istanbul`).catch(() => {})
      sendPushToUser(user.id, {
        title: '🔐 New login detected',
        body: `Your account was accessed from a new IP: ${loginIp}`,
        link: '/settings',
      }).catch(() => {})
      // Add IP to known list (keep last 20)
      const updatedIps = [...new Set([...(user.knownIps ?? []), loginIp])].slice(-20)
      await prisma.user.update({ where: { id: user.id }, data: { knownIps: updatedIps } })
    }

    await Promise.all([
      createSession({ id: user.id, name: user.name, email: user.email, role: user.role, color: user.color, partnerId: user.partnerId || undefined, tokenVersion: user.tokenVersion }),
      prisma.user.update({ where: { id: user.id }, data: { lastActive: new Date() } }),
    ])

    return NextResponse.json({
      id: user.id, name: user.name, email: user.email, role: user.role, color: user.color, initials,
      bio: user.bio, neighborhood: user.neighborhood, instagram: user.instagram,
      emailVerified: user.emailVerified, isClubHost, partnerId: user.partnerId,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
