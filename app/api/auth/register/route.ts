import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { sendVerificationEmail, sendAlreadyRegisteredEmail, sendFinishRegistrationEmail, recordEmailFailure } from '@/lib/email'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'
import { coerceNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { hashToken } from '@/lib/tokenHash'
import { getPostHogClient, trackServer } from '@/lib/posthog-server'
import { formatName } from '@/lib/data'

const COLORS = ['#f472b6','#60a5fa','#fbbf24','#f87171','#fb923c','#e879f9','#34d399','#a78bfa','#22d3ee','#4ade80']

export async function POST(req: NextRequest) {
  if (!await rateLimit(`register:${getIp(req)}`, 5, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }
  try {
    const { name, email, password, phone, nationality, languages, interests, clubIds, neighborhood, _cf } = await req.json()

    if (!(await verifyTurnstile(_cf ?? '', getIp(req)))) {
      return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
    }

    if (!name || !name.trim() || !email || !password || !phone || !nationality || !languages?.length || !interests?.length) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }
    // 8-char minimum (owner's call, 2026-08-22 — friction over the
    // marginal bcrypt-cracking risk). Rate limit + lockout protect
    // the online attack surface.
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const blacklisted = await prisma.blacklist.findFirst({
      where: { OR: [{ email: email.toLowerCase().trim() }, phone ? { phone } : {}] },
    })
    if (blacklisted) {
      return NextResponse.json({ error: 'This account is not permitted to register.' }, { status: 403 })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const existing = await prisma.user.findUnique({
      where:  { email: normalizedEmail },
      select: { id: true, name: true, email: true, emailVerified: true },
    })
    if (existing) {
      if (existing.emailVerified) {
        // A2 full fix: both new + duplicate paths return identical
        // 200 `{ pending: true, checkEmail: true }`. The actual
        // outcome routes through the email — legit owner sees
        // "someone tried to register with your email — sign in
        // here?" while a brand-new registrant gets the verification
        // link. From the outside, response status + body are
        // indistinguishable; no enumeration oracle survives.
        // EM4 fix: log delivery failures so a misconfigured SMTP
        // doesn't quietly leave legit owners with no signal about
        // the impostor-register attempt.
        sendAlreadyRegisteredEmail(existing.email, existing.name)
          .catch(async err => {
            console.error('[auth register] sendAlreadyRegisteredEmail failed', { userId: existing.id, err: String(err) })
            await recordEmailFailure({ helper: 'sendAlreadyRegisteredEmail', recipient: existing.email, error: err, context: { userId: existing.id } })
          })
        return NextResponse.json({ pending: true, checkEmail: true })
      }
      // The previous registration never verified the email, so we can't tell
      // whether it was the real applicant or a squatter. We used to WIPE the
      // row and let the new registrant recreate it with THEIR password — an
      // account-takeover primitive. Now the inbox owner gets a "choose your
      // password & finish" link that rides the RESET flow: clicking proves
      // inbox ownership, verifies the email, and REPLACES whatever password
      // is on the row — so it's safe in both orderings (squatter registered
      // first OR re-registered second, their password dies either way).
      // Outstanding plain-verify tokens are killed too: one of those alone
      // would flip emailVerified without touching the row's password.
      // Response shape matches the verified-duplicate branch above so
      // nothing enumerates.
      const reToken    = randomBytes(32).toString('hex')
      const reExpires  = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
      await prisma.$transaction([
        prisma.emailVerificationToken.deleteMany({ where: { userId: existing.id } }),
        prisma.passwordResetToken.deleteMany({ where: { userId: existing.id } }),
        prisma.passwordResetToken.create({
          data: { userId: existing.id, token: hashToken(reToken), expiresAt: reExpires },
        }),
      ])
      sendFinishRegistrationEmail(existing.email, existing.name, reToken).catch(async err => {
        console.error('[auth register] sendFinishRegistrationEmail failed', { userId: existing.id, err: String(err) })
        await recordEmailFailure({ helper: 'sendFinishRegistrationEmail', recipient: existing.email, error: err, context: { userId: existing.id } })
      })
      return NextResponse.json({ pending: true, checkEmail: true })
    }

    const application = await prisma.memberApplication.findFirst({
      where: { email: normalizedEmail, status: 'approved' },
    })

    if (!application) {
      return NextResponse.json(
        { error: 'No approved application found for this email. Please apply first.' },
        { status: 403 },
      )
    }

    const hashed = await bcrypt.hash(password, 10)
    const color  = COLORS[Math.floor(Math.random() * COLORS.length)]

    // Carry the openTo flags + languages forward from the approved application
    // so the new member lands discoverable in /members filters on day 1.
    // Registration form values take priority; fall back to application values.
    const langsFromReg = Array.isArray(languages) ? languages : []
    const user = await prisma.user.create({
      data: {
        name:         formatName(name),
        email:        normalizedEmail,
        password:     hashed,
        color,
        role:         'member',
        status:       application ? 'approved' : 'pending',
        phone:        (phone || application.phone) ?? null,
        nationality:  (nationality || application.country) ?? null,
        // Validated against the city this account is being created in, not
        // Istanbul's list: a Bodrum registration passing an Istanbul district
        // (stale client, hand-typed value) would create a member who is
        // invisible to every neighborhood feature from their first minute.
        // Coerced rather than rejected — a bad neighborhood must never be the
        // reason a paid-for, approved application can't finish registering.
        neighborhood: await coerceNeighborhoodFor(application.targetCityId, neighborhood, 'register'),
        languages:    langsFromReg.length > 0 ? langsFromReg : (application?.languages ?? []),
        interests:    Array.isArray(interests)  ? interests  : [],
        openToCoffee:   application?.openToCoffee   ?? false,
        openToLanguage: application?.openToLanguage ?? false,
        openToHosting:  application?.openToHosting  ?? false,
        // City inherits from the approved application's targetCityId
        // — the applicant told us which community they were joining
        // when they applied.
        cityId:         application.targetCityId,
      },
    })

    const enrollInClub = async (clubId: string, label: string) => {
      try {
        await prisma.$transaction([
          prisma.clubMembership.upsert({
            where:  { userId_clubId: { userId: user.id, clubId } },
            create: { userId: user.id, clubId, role: 'member', status: 'approved' },
            update: {},
          }),
          prisma.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } }),
        ])
        return { clubId, ok: true as const }
      } catch (e) {
        console.error(`[register] ${label} failed for user=${user.id} club=${clubId}:`, e)
        return { clubId, ok: false as const }
      }
    }

    const failedClubs: string[] = []

    // Auto-enroll in clubs assigned during application review
    if (application?.assignedClubs?.length) {
      const results = await Promise.all(
        application.assignedClubs.map(clubId => enrollInClub(clubId, 'assigned-club enrollment')),
      )
      failedClubs.push(...results.filter(r => !r.ok).map(r => r.clubId))
    }

    // Auto-join clubs selected during onboarding
    if (Array.isArray(clubIds) && clubIds.length > 0) {
      const results = await Promise.all(
        clubIds.map((clubId: string) => enrollInClub(clubId, 'onboarding club join')),
      )
      failedClubs.push(...results.filter(r => !r.ok).map(r => r.clubId))
    }

    // Create verification token. A6 fix: 24h → 7d. The 24-hour
    // window locked out members who didn't check email same-day;
    // the unverified account is already gated from login so a
    // longer window doesn't widen the attack surface.
    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) // 7 days
    // Email plaintext, store hash — see lib/tokenHash.ts.
    await prisma.emailVerificationToken.create({ data: { userId: user.id, token: hashToken(token), expiresAt } })

    // Send verification email (fire and forget — don't block registration)
    sendVerificationEmail(user.email, user.name, token).catch(async err => {
      console.error('[auth register] sendVerificationEmail failed', { userId: user.id, err: String(err) })
      await recordEmailFailure({ helper: 'sendVerificationEmail', recipient: user.email, error: err, context: { userId: user.id } })
    })

    // A2 full fix: no auto-session. Member must verify their email
    // before logging in. This is what makes the new-registration
    // response identical to the duplicate-registration response —
    // both return { pending: true, checkEmail: true } so an
    // attacker probing for registered emails sees the same shape
    // either way. The PostHog identify/track still fires (the
    // user row exists) so cohort splits and registration funnels
    // stay accurate.
    getPostHogClient()?.identify({
      distinctId: user.id,
      properties: { role: user.role, neighborhood: user.neighborhood },
    })
    trackServer({ id: user.id, role: user.role }, 'member_registered', {
      interests:      user.interests,
      languages:      user.languages,
      neighborhood:   user.neighborhood,
      nationality:    user.nationality,
      clubs_enrolled: (application?.assignedClubs?.length ?? 0) + (Array.isArray(clubIds) ? clubIds.length : 0),
    })

    return NextResponse.json({
      pending: true,
      checkEmail: true,
      // failedClubs surfaces only when there were club-enrollment
      // failures the user might want to retry post-verification —
      // it's not an enumeration vector because it's empty in the
      // overwhelming majority of cases.
      ...(failedClubs.length ? { failedClubs } : {}),
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
