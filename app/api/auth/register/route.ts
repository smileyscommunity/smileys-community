import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { sendVerificationEmail } from '@/lib/email'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'

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

    if (!name || !email || !password || !phone || !nationality || !languages?.length || !interests?.length) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }
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
      select: { id: true, emailVerified: true },
    })
    if (existing) {
      if (existing.emailVerified) {
        return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
      }
      // The previous registration never verified the email, so we can't tell whether
      // it was the real applicant or a squatter who guessed an approved email. The
      // squatter can't log in (verification gate blocks them), but their row would
      // otherwise block the real applicant from claiming the slot. Wipe the
      // incomplete row so the real applicant can register fresh.
      const oldMemberships = await prisma.clubMembership.findMany({
        where: { userId: existing.id, status: 'approved' },
        select: { clubId: true },
      })
      await prisma.$transaction([
        ...oldMemberships.map(m =>
          prisma.club.update({ where: { id: m.clubId }, data: { memberCount: { decrement: 1 } } })
        ),
        // Cascade-deletes ClubMembership, EmailVerificationToken, etc. via onDelete: Cascade.
        prisma.user.delete({ where: { id: existing.id } }),
      ])
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

    const hashed   = await bcrypt.hash(password, 10)
    const color    = COLORS[Math.floor(Math.random() * COLORS.length)]
    const initials = name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

    const user = await prisma.user.create({
      data: {
        name:         name.trim(),
        email:        normalizedEmail,
        password:     hashed,
        color,
        role:         'member',
        status:       application ? 'approved' : 'pending',
        phone:        phone        ?? null,
        nationality:  nationality  ?? null,
        neighborhood: neighborhood ?? null,
        languages:    Array.isArray(languages) ? languages : [],
        interests:    Array.isArray(interests)  ? interests  : [],
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

    // Create verification token
    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hours
    await prisma.emailVerificationToken.create({ data: { userId: user.id, token, expiresAt } })

    // Send verification email (fire and forget — don't block registration)
    sendVerificationEmail(user.email, user.name, token).catch(console.error)

    await createSession({ id: user.id, name: user.name, email: user.email, role: user.role, color: user.color })

    return NextResponse.json({
      id: user.id, name: user.name, email: user.email, role: user.role, color, initials,
      ...(failedClubs.length ? { failedClubs } : {}),
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
