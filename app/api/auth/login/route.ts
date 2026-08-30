import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'
import { sendNewDeviceLoginEmail, sendAccountLockedEmail, recordEmailFailure } from '@/lib/email'
import { sendPushToUser } from '@/lib/push'
import { hostCityIds } from '@/lib/access'
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

    const { email, password, _cf, _fp } = await req.json()
    // FingerprintJS visitorId from the login page. Stored on User.lastFingerprint
    // after auth succeeds so admins can grep across accounts ("is this banned
    // user back on a new email?"). 64-char cap matches the apply route's
    // sanitisation.
    const loginFingerprint = typeof _fp === 'string' && _fp ? _fp.slice(0, 64) : null

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
                fingerprints: true, tokenVersion: true } })
    if (!user || !user.password) {
      // Burn equivalent CPU time so attackers can't distinguish "no such user"
      // from "wrong password" by measuring response latency.
      await bcrypt.compare(password, TIMING_GUARD_HASH)
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Verify the password FIRST, then enforce lockout only on a WRONG guess
    // (below). A correct password always succeeds even while "locked" — this
    // closes a lockout-DoS: an attacker who knows a victim's email could
    // otherwise submit 10 wrong passwords (rotating IPs) to lock the real
    // owner out for an hour. Brute-force protection is unchanged: after 10
    // failures, further wrong attempts are rejected for an hour, capping
    // online guessing at ~10/hour/account.
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      // Locked → reject further wrong guesses. Same generic 429 as the IP
      // limit (A3 fix: a distinct "account locked" message would confirm the
      // email is registered). Does NOT increment while locked, so the counter
      // can't run away.
      if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
        return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
      }
      const newCount = (user.failedLoginCount ?? 0) + 1
      const lockUntil = newCount >= 10 ? new Date(Date.now() + 60 * 60_000) : null
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: newCount, loginLockedUntil: lockUntil ?? undefined },
      })
      if (newCount === 10) {
        // EM5 fix: log SMTP failures. Lockout email is the only
        // signal a legit user gets that someone tried brute-
        // forcing their account; silent swallow means they don't
        // know to rotate their password.
        sendAccountLockedEmail(user.email, user.name)
          .catch(async err => {
            console.error('[auth login] sendAccountLockedEmail failed', { userId: user.id, err: String(err) })
            await recordEmailFailure({ helper: 'sendAccountLockedEmail', recipient: user.email, error: err, context: { userId: user.id } })
          })
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
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
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

    const [isClubHost, cityIds] = await Promise.all([
      prisma.clubMembership.count({
        where: { userId: user.id, status: 'approved', role: 'host' },
      }).then(c => c > 0),
      // City-level hosting authority — the /host panel gates read this, and
      // the post-login redirect sends city hosts there too.
      hostCityIds(user.id),
    ])

    // New device / IP detection. A5 fix: also maintain a rolling
    // `fingerprints` history (last 50, deduped) so admins
    // searching for a banned user across accounts can match on
    // any prior device, not just the most recent one. Same
    // shape as knownIps below — read-modify-write because
    // Prisma's String[] push doesn't trim.
    const loginIp = getIp(req)
    const isNewIp  = loginIp && !(user.knownIps ?? []).includes(loginIp)
    const updatedFingerprints = loginFingerprint
      ? [...new Set([...(user.fingerprints ?? []), loginFingerprint])].slice(-50)
      : null
    if (isNewIp) {
      const loginTime = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' })
      // EM5 fix: new-device email is a security signal — silent
      // SMTP failure means a compromised login goes un-noticed.
      sendNewDeviceLoginEmail(user.email, user.name, loginIp, `${loginTime} (Türkiye)`)
        .catch(async err => {
          console.error('[auth login] sendNewDeviceLoginEmail failed', { userId: user.id, loginIp, err: String(err) })
          await recordEmailFailure({ helper: 'sendNewDeviceLoginEmail', recipient: user.email, error: err, context: { userId: user.id, loginIp } })
        })
      sendPushToUser(user.id, {
        title: '🔐 New login detected',
        body: `Your account was accessed from a new IP: ${loginIp}`,
        link: '/settings',
      }).catch(() => {})
      // Add IP to known list (keep last 20)
      const updatedIps = [...new Set([...(user.knownIps ?? []), loginIp])].slice(-20)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          knownIps: updatedIps,
          // Stamp lastFingerprint on every successful login (not just new IPs)
          // so the cross-account match always reflects the most recent device.
          // fingerprints[] gives admins the full history for cross-account match.
          ...(loginFingerprint ? { lastFingerprint: loginFingerprint } : {}),
          ...(updatedFingerprints ? { fingerprints: updatedFingerprints } : {}),
        },
      })
    } else if (loginFingerprint) {
      // Same-IP login from a different device — still stamp the
      // fingerprint + extend the history.
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastFingerprint: loginFingerprint,
          ...(updatedFingerprints ? { fingerprints: updatedFingerprints } : {}),
        },
      })
    }

    await Promise.all([
      createSession(
        { id: user.id, name: user.name, email: user.email, role: user.role, color: user.color, partnerId: user.partnerId || undefined, tokenVersion: user.tokenVersion },
        { userAgent: req.headers.get('user-agent'), ip: getIp(req) },
      ),
      prisma.user.update({ where: { id: user.id }, data: { lastActive: new Date() } }),
    ])

    return NextResponse.json({
      id: user.id, name: user.name, email: user.email, role: user.role, color: user.color, initials,
      bio: user.bio, neighborhood: user.neighborhood, instagram: user.instagram,
      emailVerified: user.emailVerified, isClubHost, hostCityIds: cityIds, partnerId: user.partnerId,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
