import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { coerceNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { Prisma } from '@prisma/client'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator, failClosedCityId } from '@/lib/access'
import { loadCommunitySettings } from '@/lib/communitySettings'
import { sendActivationEmail, sendApplicationRejectedEmail, sendRequestMoreInfoEmail, recordEmailFailure } from '@/lib/email'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { randomBytes } from 'crypto'
import { hashToken } from '@/lib/tokenHash'
import { promoteApplicationPhoto } from '@/lib/promotePhoto'
import { getStatsFor } from '@/lib/cities'
import { CITY_MATURITY } from '@/lib/cityMaturity'
import { foundingRankFor, foundingFellowNames } from '@/lib/foundingRank'
import { clubsForApprovedCity, type SkippedClub } from '@/lib/approvalClubs'

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
      select: { status: true, targetCityId: true, targetCity: { select: { slug: true } } },
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
    // Anything else a moderator sends is the admin update below — a body with
    // neither status nor suggestion fell through to it, and could set the
    // clubs (a private one included) the member is enrolled in on approval.
    // Their review note is theirs to save; nothing else.
    if (!isAdmin(session)) {
      if (reviewNote !== undefined && assignedClubs === undefined) {
        const application = await prisma.memberApplication.update({
          where: { id },
          data:  { reviewNote: typeof reviewNote === 'string' ? reviewNote.slice(0, 2000) || null : null },
        })
        return NextResponse.json(application)
      }
      return NextResponse.json({ error: 'Moderators can only suggest' }, { status: 403 })
    }

    // Cross-city default-club backstop. The client pre-fills approvals with
    // the settings-wide default club (quick + bulk approve send it blind), and
    // that default is a single city's club — so an Antalya applicant approved
    // from the queue landed in the default city's social club. When the
    // default club is city-scoped to a city OTHER than the application's
    // target, swap it for the target city's own `social-<citySlug>` starter
    // club (see lib/seedCityClubs — every seeded city has one), or drop it if
    // that club is missing/inactive. Any OTHER club outside the target city is
    // then dropped by the city filter below.
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

    // A member approved into a city is only ever put in that city's clubs or
    // global ones (cityId null). Nine members approved into Antalya and İzmir
    // were enrolled in a default-city club by a hand-picked assignment the
    // backstop above let through. Skipped clubs are logged, kept out of the
    // stored list (registration enrols from it too) and named in the response
    // and the approval audit row.
    let skippedClubs: SkippedClub[] = []
    if (clubsToAssign?.length) {
      const split = await clubsForApprovedCity(clubsToAssign, target.targetCityId)
      clubsToAssign = split.keep
      skippedClubs  = split.skipped
      if (skippedClubs.length) {
        console.warn(`[applications] application ${id}: skipped clubs outside city ${target.targetCityId}`, skippedClubs)
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
      // Auto-create account if not already exists. Awaited: this used to run
      // detached with console.error as its only handler, so a Resend outage
      // or a photo-promotion throw left the applicant with no activation link
      // while the admin saw "approved". Re-sending the same approval retries
      // it (the existing-user branch below is idempotent).
      let accountError: unknown = null
      await (async () => {
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
                  lookingFor:   application.lookingFor   ?? [],
                  // The applicant's own choices, not the schema's defaults.
                  emailMarketing:  application.emailMarketing ?? false,
                  termsAcceptedAt: application.termsAcceptedAt ?? null,
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
            // Auto-enroll in assigned clubs. Re-filtered by city: an approval
            // that sends no assignedClubs enrols from the list stored earlier,
            // which may predate the city filter above.
            const enrolClubs = application.assignedClubs?.length
              ? (await clubsForApprovedCity(application.assignedClubs, application.targetCityId)).keep
              : []
            if (enrolClubs.length) {
              await Promise.all(enrolClubs.map((clubId: string) =>
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
            // Rank and names come from lib/foundingRank, the dashboard panel's
            // own definition: activated members only. The account was just
            // created without a password, so it ranks after everyone counted.
            let founding: { rank: number; others: string[] } | undefined
            if (isFoundingCity) {
              const [rank, others] = await Promise.all([
                foundingRankFor(application.targetCityId, { joinedAt: user.joinedAt, activated: false }),
                foundingFellowNames(application.targetCityId, user.id),
              ])
              founding = { rank, others }
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
          accountError = e
        }
      })()
      if (accountError) {
        // Put the row back where it was so the Approve button is still there
        // after a reload — the queue only offers it for pending/hold rows.
        await prisma.memberApplication.update({
          where: { id },
          data:  { status: target.status, reviewedBy: null, reviewedAt: null },
        }).catch(err => console.error('[applications] rollback after account error failed', { id, err: String(err) }))
        const msg = accountError instanceof Error ? accountError.message : String(accountError)
        return NextResponse.json(
          { error: `The account could not be set up (${msg}). The application is back in the queue — approve again to retry.` },
          { status: 500 },
        )
      }
    } else if (status === 'rejected') {
      // Revoke member access if a user account exists
      const linkedUser = await prisma.user.findUnique({ where: { email: application.email }, select: { id: true, status: true } })
      if (linkedUser && linkedUser.status === 'approved') {
        // 'pending' is only enforced at login; the bump revokes the live session.
        await prisma.user.update({ where: { id: linkedUser.id }, data: { status: 'pending', tokenVersion: { increment: 1 } } })
      }
      sendApplicationRejectedEmail(application.email, application.fullName, rejectionMessage)
        .catch(err => recordEmailFailure({ helper: 'sendApplicationRejectedEmail', recipient: application.email, error: err, context: { applicationId: id } }))
      // cityId passed rather than left to the lookup: the application's city
      // is already in hand, and moderators' city-scoped audit view reads it.
      writeAudit(session.id, session.name, 'application.reject', id, 'memberApplication',
        { name: application.fullName, email: application.email, note: reviewNote, cityId: target.targetCityId },
        `Application rejected — ${application.fullName} (${application.email})${reviewNote ? `: ${reviewNote}` : ''}`,
      )
    } else if (status === 'hold') {
      if (moreInfoMessage?.trim()) {
        sendRequestMoreInfoEmail(application.email, application.fullName, moreInfoMessage.trim())
          .catch(err => recordEmailFailure({ helper: 'sendRequestMoreInfoEmail', recipient: application.email, error: err, context: { applicationId: id } }))
      }
      // Parking an application is a decision too — it had no audit row at all.
      writeAudit(session.id, session.name, 'application.hold', id, 'memberApplication',
        { name: application.fullName, email: application.email, note: reviewNote, moreInfoRequested: !!moreInfoMessage?.trim(), cityId: target.targetCityId },
        `Application put on hold — ${application.fullName} (${application.email})${reviewNote ? `: ${reviewNote}` : ''}`,
      )
    }

    if (status === 'approved') {
      writeAudit(session.id, session.name, 'application.approve', id, 'memberApplication',
        { name: application.fullName, email: application.email, cityId: target.targetCityId, ...(skippedClubs.length ? { skippedClubs } : {}) },
        `Application approved — ${application.fullName} (${application.email}) is now a member`,
      )
    }

    return NextResponse.json(skippedClubs.length ? { ...application, skippedClubs } : application)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
