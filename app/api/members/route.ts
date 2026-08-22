import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { isAdminOrModerator, isClubHost } from '@/lib/access'
import { resolveCityId } from '@/lib/city'
import { LOOKING_FOR_VALUES } from '@/lib/profileOptions'

const PAGE_SIZE = 100

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`members:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const offset    = Math.max(parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10) || 0, 0)
  const isHost    = req.nextUrl.searchParams.get('isHost') === 'true'
  const adminOnly = req.nextUrl.searchParams.get('adminOnly') === 'true'
  const savedOnly = req.nextUrl.searchParams.get('savedOnly') === 'true'
  const aroundNow = req.nextUrl.searchParams.get('aroundNow') === 'true'
  const openTo    = req.nextUrl.searchParams.get('openTo')
  const lookingFor   = req.nextUrl.searchParams.get('lookingFor')
  const speaksMyLang = req.nextUrl.searchParams.get('speaksMyLang') === 'true'
  const search    = req.nextUrl.searchParams.get('search')?.trim() ?? ''

  const openFilter: Prisma.UserWhereInput =
    openTo === 'coffee'   ? { openToCoffee:   true } :
    openTo === 'language' ? { openToLanguage: true } :
    openTo === 'hosting'  ? { openToHosting:  true } :
    {}

  // "Looking for" — the registration answer, filterable the same way the
  // openTo flags are (it was a write-only column until phase B).
  const lookingForFilter: Prisma.UserWhereInput =
    lookingFor && LOOKING_FOR_VALUES.has(lookingFor) ? { lookingFor: { has: lookingFor } } : {}

  // Language overlap with the VIEWER — mirrors the hangouts feed's
  // "Speaks my language" filter. No languages on the viewer → no-op.
  let langFilter: Prisma.UserWhereInput = {}
  if (speaksMyLang) {
    const viewer = await prisma.user.findUnique({ where: { id: session.id }, select: { languages: true } })
    if (viewer?.languages?.length) langFilter = { languages: { hasSome: viewer.languages } }
  }

  const searchFilter: Prisma.UserWhereInput = search ? {
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      // Neighborhood + nationality are hidden on a private member's locked
      // card, so only match them on publicly-visible profiles — otherwise a
      // search could confirm a 'connections only' member's hidden attributes
      // (binary-search a nationality string against the redacted card).
      { profileVisibility: 'everyone', neighborhood: { contains: search, mode: 'insensitive' } },
      { profileVisibility: 'everyone', nationality:  { contains: search, mode: 'insensitive' } },
    ],
  } : {}

  // For savedOnly: collect the viewer's saved member IDs first.
  const savedIds = savedOnly
    ? (await prisma.memberSave.findMany({
        where:  { userId: session.id },
        select: { savedId: true },
      })).map(s => s.savedId)
    : null

  // Get IDs the current user has blocked or is blocked by
  const blockRelations = await prisma.memberBlock.findMany({
    where: { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
    select: { blockerId: true, blockedId: true },
  })
  const blockedIds = [...new Set(blockRelations.map(b =>
    b.blockerId === session.id ? b.blockedId : b.blockerId
  ))]

  // Private-account model: 'connections only' members STAY in the
  // directory (so they're discoverable and can be sent connection
  // requests), but their card is redacted to name + photo + neighborhood
  // until the viewer is connected. Full details unlock for: the member
  // themselves, accepted connections, and admins/moderators/club hosts
  // (who need full access for moderation / event management).
  //
  // Fetch the viewer's accepted-connection IDs + privilege once so the
  // result mapping below can decide per-card whether to redact.
  const conns = await prisma.memberConnection.findMany({
    where: {
      status: 'accepted',
      OR: [{ requesterId: session.id }, { receiverId: session.id }],
    },
    select: { requesterId: true, receiverId: true },
  })
  const connectionIds = new Set(conns.map(c => c.requesterId === session.id ? c.receiverId : c.requesterId))
  const privileged = isAdminOrModerator(session) || await isClubHost(session.id)

  const roleIn = ['member', 'moderator', 'admin']

  // Build the full where — each clause is ANDed together by Prisma's default.
  // Using an explicit AND array avoids TypeScript inference issues when mixing
  // OR/NOT with dynamic conditions at the same level.
  const where: Prisma.UserWhereInput = {
    AND: [
      // Browse discovery lists the viewer's own city. Saved members stay
      // cross-city — a save is a personal bookmark, not discovery.
      ...(savedOnly ? [] : [{ cityId: await resolveCityId(session) }]),
      // Everyone is listed regardless of privacy setting — 'connections
      // only' members appear as redacted cards (see result mapping), not
      // hidden. Discovery for all; details gated per-card.
      // Exclude blocked users (and users who blocked the viewer).
      blockedIds.length > 0 ? { id: { notIn: blockedIds } } : {},
      // Admin-hidden accounts (staff, test, opted-out members) never
      // appear in the directory, for any viewer.
      { hiddenFromMembers: false },
      openFilter,
      lookingForFilter,
      langFilter,
      searchFilter,
      // "Around now" — members available to meet right now: either a live
      // (non-expired) availability pulse OR an active hangout they're hosting.
      // Uses the AvailabilityPulse / Hangout back-relations on User.
      aroundNow
        ? { OR: [
            { availabilityPulses: { some: { until: { gte: new Date() } } } },
            { hangouts: { some: { status: 'active', endsAt: { gte: new Date() } } } },
          ] }
        : {},
      savedOnly && savedIds !== null
        ? { id: { in: savedIds }, status: 'approved', role: { in: roleIn } }
        : isHost
        ? { status: 'approved', role: { in: roleIn }, clubMemberships: { some: { role: 'host', status: 'approved' } } }
        : adminOnly
        ? { status: 'approved', role: 'admin' }
        : { status: 'approved', role: { in: roleIn } },
    ],
  }

  const [members, total, hostTotal, adminTotal, savedTotal] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { joinedAt: 'desc' },
      take: PAGE_SIZE,
      skip: offset,
      select: {
        id: true, name: true, color: true, bio: true,
        neighborhood: true, nationality: true, interests: true,
        languages: true, profilePhoto: true, joinedAt: true, role: true,
        instagram: true, linkedin: true, lastActive: true, socialStyles: true, lookingFor: true,
        profileVisibility: true, membershipType: true,
        openToCoffee: true, openToLanguage: true, openToHosting: true,
        clubMemberships: {
          where: { status: 'approved' },
          select: {
            role: true,
            club: { select: { id: true, name: true, emoji: true, slug: true } },
          },
        },
        _count: { select: { joinedEvents: { where: { status: 'approved' } } } },
      },
    }),
    prisma.user.count({ where }),
    prisma.user.count({
      where: {
        status: 'approved',
        hiddenFromMembers: false,
        clubMemberships: { some: { role: 'host', status: 'approved' } },
      },
    }),
    prisma.user.count({
      where: { status: 'approved', hiddenFromMembers: false, role: 'admin' },
    }),
    prisma.memberSave.count({ where: { userId: session.id } }),
  ])

  // Which of the returned members currently have a live pulse — one batched
  // query keyed on the page's member IDs, surfaced as a per-card `activePulse`
  // flag (drives the "🟢 free now" badge).
  const pulseUserIds = new Set(
    (await prisma.availabilityPulse.findMany({
      where:  { until: { gte: new Date() }, userId: { in: members.map(m => m.id) } },
      select: { userId: true },
    })).map(p => p.userId),
  )

  const result = members.map(m => {
    // A 'connections only' member is redacted unless the viewer is
    // allowed full access: themselves, an accepted connection, or a
    // privileged role (admin/moderator/club host).
    const restricted =
      m.profileVisibility === 'connections' &&
      m.id !== session.id &&
      !privileged &&
      !connectionIds.has(m.id)

    if (restricted) {
      // Minimal locked card: identity + neighborhood only. Personal
      // details (bio, interests, languages, socials, clubs) are gated
      // behind a connection — the full profile 404s for non-connections.
      return {
        id: m.id, name: m.name, color: m.color, bio: null,
        neighborhood: m.neighborhood, nationality: null,
        interests: [] as string[], languages: [] as string[],
        socialStyles: [] as string[], lookingFor: [] as string[],
        profilePhoto: m.profilePhoto, joinedAt: m.joinedAt,
        role: m.role, instagram: null, linkedin: null, lastActive: null,
        membershipType: m.membershipType,
        isHost: false, clubs: [] as { id: string; name: string; emoji: string | null; slug: string; isHost: boolean }[],
        eventsCount: 0,
        activePulse: pulseUserIds.has(m.id),
        restricted: true,
      }
    }

    return {
      id: m.id, name: m.name, color: m.color, bio: m.bio,
      neighborhood: m.neighborhood, nationality: m.nationality,
      interests: m.interests, languages: m.languages,
      socialStyles: m.socialStyles, lookingFor: m.lookingFor,
      profilePhoto: m.profilePhoto, joinedAt: m.joinedAt,
      role: m.role, instagram: m.instagram, linkedin: m.linkedin, lastActive: m.lastActive,
      membershipType: m.membershipType,
      isHost:      m.clubMemberships.some(cm => cm.role === 'host'),
      clubs:       m.clubMemberships.map(cm => ({ ...cm.club, isHost: cm.role === 'host' })),
      eventsCount: m._count.joinedEvents,
      activePulse: pulseUserIds.has(m.id),
      restricted: false,
    }
  })

  return NextResponse.json({ members: result, total, hostTotal, adminTotal, savedTotal, hasMore: offset + PAGE_SIZE < total, isFiltered: isHost || adminOnly || savedOnly })
}
