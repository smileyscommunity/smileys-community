import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { coerceNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { Prisma } from '@prisma/client'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator, failClosedCityId } from '@/lib/access'
import { loadCommunitySettings } from '@/lib/communitySettings'
import { sendActivationEmail, sendApplicationRejectedEmail, sendRequestMoreInfoEmail } from '@/lib/email'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { randomBytes } from 'crypto'
import { hashToken } from '@/lib/tokenHash'
import { promoteApplicationPhoto } from '@/lib/promotePhoto'
import { getStatsFor } from '@/lib/cities'
import { CITY_MATURITY } from '@/lib/cityMaturity'
import { firstNameOf } from '@/lib/data'

function normalizeName(name: string): string {
  if (!name) return name
  const trimmed = name.trim()
  // Only fix fully all-caps names
  if (trimmed !== trimmed.toUpperCase()) return trimmed
  return trimmed
    .split(' ')
    .map(w => w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)
    .join(' ')
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Moderators see only applications targeting their own city. Admins
    // see everything (cross-city audits + global review), optionally
    // narrowed to one city via ?city= — the moderator scope wins over the
    // param so a moderator can't widen their view by passing one.
    const cityParam = req.nextUrl.searchParams.get('city')
    const cityFilter = isAdmin(session)
      ? (cityParam ? { targetCityId: cityParam } : {})
      : { targetCityId: failClosedCityId(session) }
    const applications = await prisma.memberApplication.findMany({
      where:   cityFilter,
      orderBy: { createdAt: 'desc' },
      include: {
        reviewer:   { select: { name: true } },
        targetCity: { select: { name: true, slug: true } },
      },
    })
    return NextResponse.json(applications)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id, status, suggestion, reviewNote, assignedClubs, rejectionMessage, welcomeMessage, moreInfoMessage } = await req.json()

    // City-scope check — fetch the application's target city so a
    // Berlin moderator can't suggest on / decide an Istanbul-targeted
    // application by hitting the API directly. Admins act globally.
    const target = await prisma.memberApplication.findUnique({
      where:  { id },
      select: { targetCityId: true, targetCity: { select: { slug: true } } },
    })
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!isAdmin(session) && session.cityId !== target.targetCityId) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }

    // Moderators can only suggest — not set final status
    if (!isAdmin(session) && status !== undefined && status !== null) {
      return NextResponse.json({ error: 'Moderators cannot set final status' }, { status: 403 })
    }

    // Moderator submitting a suggestion
    if (!isAdmin(session) && suggestion !== undefined) {
      const application = await prisma.memberApplication.update({
        where: { id },
        data: { suggestion: suggestion || null, suggestedBy: session.id, reviewNote: reviewNote || null },
      })
      return NextResponse.json(application)
    }

    // Cross-city default-club backstop. The client pre-fills approvals with
    // the settings-wide default club (quick + bulk approve send it blind), and
    // that default is a single city's club — so an Antalya applicant approved
    // from the queue landed in the default city's social club. When the
    // default club is city-scoped to a city OTHER than the application's
    // target, swap it for the target city's own `social-<citySlug>` starter
    // club (see lib/seedCityClubs — every seeded city has one), or drop it if
    // that club is missing/inactive. Only the settings default is touched:
    // an admin deliberately assigning some other city's club, or a global
    // club (cityId null), passes through untouched.
    let clubsToAssign: string[] | undefined = Array.isArray(assignedClubs) ? assignedClubs : undefined
    if (clubsToAssign?.length) {
      const defaultClubId = loadCommunitySettings().defaultClubId
      if (defaultClubId && clubsToAssign.includes(defaultClubId)) {
        const defaultClub = await prisma.club.findUnique({ where: { id: defaultClubId }, select: { cityId: true } })
        if (defaultClub?.cityId && defaultClub.cityId !== target.targetCityId) {
          const socialSlug = `social-${target.targetCity.slug}`
          const social = await prisma.club.findFirst({
            where:  { slug: socialSlug, cityId: target.targetCityId, isActive: true },
            select: { id: true },
          })
          clubsToAssign = clubsToAssign.filter(clubId => clubId !== defaultClubId)
          if (social) {
            if (!clubsToAssign.includes(social.id)) clubsToAssign.push(social.id)
            console.log(`[applications] application ${id}: default club ${defaultClubId} is another city's — substituted ${socialSlug} (${social.id})`)
          } else {
            console.warn(`[applications] application ${id}: default club ${defaultClubId} is another city's and no active ${socialSlug} exists — dropped`)
          }
        }
      }
    }

    // Admin full update
    const application = await prisma.memberApplication.update({
      where: { id },
      data: {
        status,
        reviewNote:    reviewNote    || null,
        assignedClubs: clubsToAssign,
        reviewedBy:    session.id,
        reviewedAt:    new Date(),
      },
    })

    if (status === 'approved') {
      // Auto-create account if not already exists
      ;(async () => {
        try {
          // Use findUnique + create inside a check — P2002 guard handles dual-admin race
          const existing = await prisma.user.findUnique({ where: { email: application.email } })
          // Approved while the city is still seeding = founding member, a
          // permanent stored fact (see the schema note). Derived HERE, at the
          // moment of approval — the flag must reflect what the city was when
          // they joined, not what it later became. A stats failure must never
          // block an approval, so this degrades to false.
          let isFoundingCity = false
          try {
            const cityStats = (await getStatsFor([application.targetCityId])).get(application.targetCityId)
            isFoundingCity = cityStats?.maturity === CITY_MATURITY.Seeding
          } catch (e) {
            console.error('Founding-stage check failed (approving anyway):', e)
          }
          if (!existing) {
            const COLORS = ['#f472b6','#60a5fa','#fbbf24','#f87171','#fb923c','#e879f9','#34d399','#a78bfa']
            const color  = COLORS[Math.floor(Math.random() * COLORS.length)]
            // Move the applicant photo out of the gated applications/ folder
            // into users/ before it becomes a member avatar — otherwise the
            // member's public avatar points into applications/, and the file
            // route can only serve it by trusting the user-writable
            // profilePhoto column (a bypassable gate). See lib/promotePhoto.
            const memberPhoto = await promoteApplicationPhoto(application.profilePhoto)
            let user
            try {
              user = await prisma.user.create({
                data: {
                  name:         normalizeName(application.fullName),
                  email:        application.email,
                  password:     null,
                  color,
                  role:         'member',
                  status:       'approved',
                  emailVerified: true,
                  phone:        application.phone        ?? null,
                  nationality:  application.country      ?? null,
                  gender:       application.gender       ?? null,
                  interests:    application.interests    ?? [],
                  socialStyles: application.socialStyles ?? [],
                  languages:    [],
                  profilePhoto: memberPhoto ?? null,
                  bio:          application.bio          ?? null,
                  instagram:    application.instagram    ?? null,
                  // Coerced against the city being joined, never rejected: a bad
                  // neighborhood on an application must not block an approval.
                  // Null beats a value no neighborhood feature can ever match.
                  neighborhood: await coerceNeighborhoodFor(application.targetCityId, application.neighborhood, `approve application ${application.id}`),
                  // User joins the city they applied to.
                  cityId:       application.targetCityId,
                  foundingMember: isFoundingCity,
                },
              })
            } catch (e) {
              // P2002 = unique constraint — second admin approved simultaneously, user already created
              if (e instanceof Prisma.PrismaClientKnownRequestError && (e as Prisma.PrismaClientKnownRequestError).code === 'P2002') return
              throw e
            }
            // Auto-enroll in assigned clubs
            if (application.assignedClubs?.length) {
              await Promise.all(application.assignedClubs.map((clubId: string) =>
                prisma.$transaction([
                  prisma.clubMembership.upsert({
                    where:  { userId_clubId: { userId: user.id, clubId } },
                    create: { userId: user.id, clubId, role: 'member', status: 'approved' },
                    update: {},
                  }),
                  prisma.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } }),
                ]).catch((e: unknown) => console.error(`Admin club enrollment failed for ${clubId}:`, e))
              ))
            }
            // Generate activation token (7 days)
            const token     = randomBytes(32).toString('hex')
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            // Email plaintext, store hash — see lib/tokenHash.ts.
            await prisma.passwordResetToken.create({ data: { userId: user.id, token: hashToken(token), expiresAt } })
            const targetCity = await prisma.city.findUnique({ where: { id: application.targetCityId }, select: { name: true } })
            // Founding members get their rank and the first names of the
            // people already in — joining a five-person city should feel like
            // being let into something, not like arriving at an empty room.
            let founding: { rank: number; others: string[] } | undefined
            if (isFoundingCity) {
              const MEMBER_ROLES = { notIn: ['admin', 'partner'] }
              const [rank, fellows] = await Promise.all([
                prisma.user.count({
                  where: { cityId: application.targetCityId, status: 'approved', role: MEMBER_ROLES, joinedAt: { lte: user.joinedAt } },
                }),
                prisma.user.findMany({
                  where: {
                    cityId: application.targetCityId, status: 'approved', role: MEMBER_ROLES,
                    foundingMember: true, id: { not: user.id }, hiddenFromMembers: false,
                  },
                  orderBy: { joinedAt: 'asc' },
                  take: 3,
                  select: { name: true },
                }),
              ])
              founding = { rank: Math.max(1, rank), others: fellows.map(f => firstNameOf(f.name)) }
            }
            await sendActivationEmail(application.email, application.fullName, token, welcomeMessage || undefined, targetCity?.name, founding)
          } else {
            // User already exists — fill in any missing profile fields from the application
            const updates: Record<string, unknown> = {}
            if (!existing.phone        && application.phone)        updates.phone        = application.phone
            if (!existing.nationality  && application.country)      updates.nationality  = application.country
            if (!existing.instagram    && application.instagram)    updates.instagram    = application.instagram
            if (!existing.profilePhoto && application.profilePhoto) updates.profilePhoto = await promoteApplicationPhoto(application.profilePhoto)
            if (!existing.neighborhood && application.neighborhood) updates.neighborhood = application.neighborhood
            if ((!existing.bio)        && application.bio)          updates.bio          = application.bio
            if (existing.interests?.length === 0 && application.interests?.length) updates.interests = application.interests
            if (existing.socialStyles?.length === 0 && application.socialStyles?.length) updates.socialStyles = application.socialStyles
            if (Object.keys(updates).length > 0) {
              await prisma.user.update({ where: { id: existing.id }, data: updates })
            }
            // Also approve their status if pending. A pending account being
            // approved into a seeding city is a founding member exactly like
            // the fresh-account path above.
            if (existing.status === 'pending') {
              await prisma.user.update({
                where: { id: existing.id },
                data: { status: 'approved', ...(isFoundingCity ? { foundingMember: true } : {}) },
              })
            }
          }
        } catch (e) {
          console.error('Auto-create account error:', e)
        }
      })()
    } else if (status === 'rejected') {
      // Revoke member access if a user account exists
      const linkedUser = await prisma.user.findUnique({ where: { email: application.email }, select: { id: true, status: true } })
      if (linkedUser && linkedUser.status === 'approved') {
        await prisma.user.update({ where: { id: linkedUser.id }, data: { status: 'pending' } })
      }
      sendApplicationRejectedEmail(application.email, application.fullName, rejectionMessage).catch(console.error)
      writeAudit(session.id, session.name, 'application.reject', id, 'memberApplication',
        { name: application.fullName, email: application.email, note: reviewNote },
        `Application rejected — ${application.fullName} (${application.email})${reviewNote ? `: ${reviewNote}` : ''}`,
      )
    } else if (status === 'hold' && moreInfoMessage?.trim()) {
      sendRequestMoreInfoEmail(application.email, application.fullName, moreInfoMessage.trim()).catch(console.error)
    }

    if (status === 'approved') {
      writeAudit(session.id, session.name, 'application.approve', id, 'memberApplication',
        { name: application.fullName, email: application.email },
        `Application approved — ${application.fullName} (${application.email}) is now a member`,
      )
    }

    return NextResponse.json(application)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
