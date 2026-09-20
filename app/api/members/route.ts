import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { isAdminOrModerator, isClubHost } from '@/lib/access'
import { resolveCityId } from '@/lib/city'
import { LOOKING_FOR_VALUES } from '@/lib/profileOptions'
import { firstNameOf } from '@/lib/data'
import { nameSearchWhere } from '@/lib/memberPrivacy'
import { searchableMemberIds } from '@/lib/memberSearch'
import { fold } from '@/lib/turkishFold'

const PAGE_SIZE = 100

// The id keeps a page boundary stable when two members share a timestamp.
// `active` puts nulls last explicitly: Postgres sorts NULLS FIRST on a DESC,
// so "most active" opened with the 200 members who have never been seen.
// (`name` is ordered in the handler — a Turkish A–Z is not the database's.)
const SORTS = {
  joined: [{ joinedAt: 'desc' as const }, { id: 'desc' as const }],
  name:   [{ name: 'asc' as const }, { id: 'asc' as const }],
  active: [{ lastActive: { sort: 'desc' as const, nulls: 'last' as const } }, { id: 'desc' as const }],
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`members:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const offset    = Math.max(parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10) || 0, 0)
  // Ordering belongs here, not in the browser: sorting A–Z client-side sorted
  // the hundred rows that happened to be loaded, and re-shuffled the list
  // under the reader whenever the next page arrived.
  const sortParam = req.nextUrl.searchParams.get('sort') ?? 'joined'
  const sort: keyof typeof SORTS = sortParam in SORTS ? sortParam as keyof typeof SORTS : 'joined'
  const isHost    = req.nextUrl.searchParams.get('isHost') === 'true'
  const adminOnly = req.nextUrl.searchParams.get('adminOnly') === 'true'
  const savedOnly = req.nextUrl.searchParams.get('savedOnly') === 'true'
  // A handful of members by id — what the page asks for when a connection is
  // accepted and the row it holds was redacted at fetch time. Bounded, and
  // every visibility rule below still applies to them.
  const ids = req.nextUrl.searchParams.get('ids')
  const idFilter: Prisma.UserWhereInput = ids
    ? { id: { in: ids.split(',').map(x => x.trim()).filter(Boolean).slice(0, 25) } }
    : {}
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

  // Name, interest and club — what the search box says it searches — with
  // Turkish letters folded so "ipek" finds İpek (lib/memberSearch). Public
  // members only: a locked member stays findable by the start of their first
  // name and nothing else.
  const searchIds = search ? await searchableMemberIds(search, await resolveCityId(session)) : []
  const searchFilter: Prisma.UserWhereInput = search ? {
    OR: [
      await nameSearchWhere(session, search, 'contains'),
      ...(searchIds.length ? [{ id: { in: searchIds } }] : []),
      // Neighborhood + nationality are hidden on a private member's locked
      // card, so only match them on publicly-visible profiles — otherwise a
      // search could confirm a 'connections only' member's hidden attributes
      // (binary-search a nationality string against the redacted card).
      { profileVisibility: 'everyone', neighborhoodVisible: true, neighborhood: { contains: search, mode: 'insensitive' } },
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

  // The filters below read fields a locked card hides — languages, what
  // they're open to, what they're looking for, a live pulse. A connections-
  // only member the viewer can't see in full isn't matched on them, or the
  // filter would say what the card withholds ("free now" under a card that
  // says nothing).
  // isHost/adminOnly belong here too: the host pill matches club membership
  // — private clubs included — and a locked card that came back said
  // `isHost: false` while its presence in the result proved otherwise.
  const filtersHidden = !!(openTo || lookingFor || speaksMyLang || aroundNow || isHost || adminOnly)
  const visibleWhere: Prisma.UserWhereInput = filtersHidden && !privileged
    ? { OR: [{ profileVisibility: { not: 'connections' } }, { id: { in: [session.id, ...connectionIds] } }] }
    : {}

  const roleIn = ['member', 'moderator', 'admin']

  // Build the full where — each clause is ANDed together by Prisma's default.
  // Using an explicit AND array avoids TypeScript inference issues when mixing
  // OR/NOT with dynamic conditions at the same level.
  const where: Prisma.UserWhereInput = {
    AND: [
      // Browse discovery lists the viewer's own city. Saved members stay
      // cross-city — a save is a personal bookmark, not discovery — and so
      // does an explicit `ids=` fetch: the page asks for a member it already
      // has a relationship with (a connection it just accepted), who may live
      // anywhere. Every other rule below still applies to them.
      ...(savedOnly || ids ? [] : [{ cityId: await resolveCityId(session) }]),
      // Everyone is listed regardless of privacy setting — 'connections
      // only' members appear as redacted cards (see result mapping), not
      // hidden. Discovery for all; details gated per-card.
      // Exclude blocked users (and users who blocked the viewer).
      blockedIds.length > 0 ? { id: { notIn: blockedIds } } : {},
      // Admin-hidden accounts (staff, test, opted-out members) never
      // appear in the directory, for any viewer.
      { hiddenFromMembers: false },
      // A suspended member is off the member surfaces until it lifts — the
      // profile page 404s for them, so the card pointed at nothing.
      { OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }] },
      idFilter,
      visibleWhere,
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
            { hangouts: { some: { status: 'active', startsAt: { lte: new Date() }, endsAt: { gte: new Date() } } } },
          ] }
        : {},
      savedOnly && savedIds !== null
        ? { id: { in: savedIds }, status: 'approved', role: { in: roleIn } }
        : isHost
        ? { status: 'approved', role: { in: roleIn }, clubMemberships: { some: { role: 'host', status: 'approved', club: { isActive: true } } } }
        : adminOnly
        ? { status: 'approved', role: 'admin' }
        : { status: 'approved', role: { in: roleIn } },
    ],
  }

  // The visibility floor every count shares with the list: this city, live
  // accounts, nobody hidden, suspended or blocked either way.
  // The Hosts and Admins lists now exclude connections-only members (their
  // filters joined `filtersHidden`), so their counts must too — otherwise the
  // difference between the number and the list is a count of private hosts.
  const pillVisible: Prisma.UserWhereInput = privileged ? {} : {
    OR: [{ profileVisibility: { not: 'connections' } }, { id: { in: [session.id, ...connectionIds] } }],
  }

  const visibleBase: Prisma.UserWhereInput = {
    status: 'approved',
    hiddenFromMembers: false,
    role: { in: roleIn },
    cityId: await resolveCityId(session),
    OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
    ...(blockedIds.length > 0 ? { id: { notIn: blockedIds } } : {}),
  }

  // A–Z is not the database's A–Z: both databases run the C collation, which
  // files every Ç/Ö/Ş/Ü/İ name after Z — in an Istanbul directory that is
  // most of the page. The ids are ordered here instead, folded the way the
  // search box folds them (lib/turkishFold), then the page is read back by
  // id. Bounded: a city's directory, ids only.
  let nameOrderedIds: string[] | null = null
  if (sort === 'name') {
    const rows = await prisma.user.findMany({ where, select: { id: true, name: true }, take: 5000 })
    nameOrderedIds = rows
      .sort((a, b) => fold(a.name).localeCompare(fold(b.name), 'tr') || a.id.localeCompare(b.id))
      .slice(offset, offset + PAGE_SIZE)
      .map(r => r.id)
  }

  const [members, total, hostTotal, adminTotal, savedTotal] = await Promise.all([
    prisma.user.findMany({
      where: nameOrderedIds ? { id: { in: nameOrderedIds } } : where,
      orderBy: SORTS[sort],
      take: PAGE_SIZE,
      skip: nameOrderedIds ? 0 : offset,
      select: {
        id: true, name: true, color: true, bio: true,
        neighborhood: true, neighborhoodVisible: true, nationality: true, interests: true,
        languages: true, profilePhoto: true, joinedAt: true, role: true,
        instagram: true, linkedin: true, lastActive: true, socialStyles: true, lookingFor: true,
        profileVisibility: true, membershipType: true, foundingMember: true,
        openToCoffee: true, openToLanguage: true, openToHosting: true,
        clubMemberships: {
          where: { status: 'approved', club: { isActive: true } },
          select: {
            role: true,
            club: { select: { id: true, name: true, emoji: true, slug: true, isPrivate: true } },
          },
        },
        _count: { select: { joinedEvents: { where: { status: 'approved' } } } },
      },
    }),
    prisma.user.count({ where }),
    // The pills count what their own list would show: city, blocks,
    // suspensions and all. They were network-wide, so a Bursa member read
    // "Admins 4" and opened an empty list (the admins are in Istanbul), and
    // the numbers quietly disclosed other cities' staff counts.
    prisma.user.count({
      where: {
        ...(visibleBase as Prisma.UserWhereInput),
        ...(pillVisible as Prisma.UserWhereInput),
        clubMemberships: { some: { role: 'host', status: 'approved', club: { isActive: true } } },
      },
    }),
    prisma.user.count({ where: { ...(visibleBase as Prisma.UserWhereInput), ...(pillVisible as Prisma.UserWhereInput), role: 'admin' } }),
    // Saved counted raw while the saved LIST filters out blocked, hidden and
    // suspended members — so "Saved 7" opening to six was a way to learn
    // somebody had blocked you. No city clause: a save is a personal
    // bookmark and the saved list is deliberately cross-city.
    prisma.user.count({
      where: {
        ...(visibleBase as Prisma.UserWhereInput),
        cityId: undefined,
        savedByMembers: { some: { userId: session.id } },
      },
    }),
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

  // The profile route gates socials and last-active behind a connection
  // (self / connected / privileged); the list handed them to anyone.
  const fullFor = (id: string) => id === session.id || privileged || connectionIds.has(id)
  // Read back by id loses the order they were chosen in; put it back.
  const ordered = nameOrderedIds
    ? nameOrderedIds.flatMap(id => members.filter(m => m.id === id))
    : members
  const result = ordered.map(m => {
    // A 'connections only' member is redacted unless the viewer is
    // allowed full access: themselves, an accepted connection, or a
    // privileged role (admin/moderator/club host).
    const restricted =
      m.profileVisibility === 'connections' &&
      m.id !== session.id &&
      !privileged &&
      !connectionIds.has(m.id)

    if (restricted) {
      // Minimal locked card, the same one the profile page shows: first
      // name and colour. The full name and photo went out here while the
      // profile itself withheld them.
      return {
        id: m.id, name: firstNameOf(m.name), color: m.color, bio: null,
        // The profile route withholds neighborhood without a connection; the
        // locked card handed it out.
        neighborhood: null, nationality: null,
        interests: [] as string[], languages: [] as string[],
        socialStyles: [] as string[], lookingFor: [] as string[],
        // Nothing the locked profile withholds: it returns no role, no join
        // date and no tier, and the card was rendering all three.
        profilePhoto: null, joinedAt: null,
        role: null, instagram: null, linkedin: null, lastActive: null,
        membershipType: null, foundingMember: false,
        isHost: false, clubs: [] as { id: string; name: string; emoji: string | null; slug: string; isHost: boolean }[],
        eventsCount: 0,
        activePulse: false,
        restricted: true,
      }
    }

    const full = fullFor(m.id)
    return {
      id: m.id, name: m.name, color: m.color, bio: m.bio,
      // Only for members who chose to be listed by neighbourhood.
      neighborhood: full || m.neighborhoodVisible ? m.neighborhood : null, nationality: m.nationality,
      interests: m.interests, languages: m.languages,
      socialStyles: m.socialStyles,
      // Shown to any member, like interests: it is a discovery signal, and
      // the "looking for" filter would confirm it one request at a time
      // anyway. The profile route returns it at the same level.
      lookingFor: m.lookingFor,
      profilePhoto: m.profilePhoto, joinedAt: m.joinedAt,
      role: m.role, instagram: fullFor(m.id) ? m.instagram : null, linkedin: fullFor(m.id) ? m.linkedin : null, lastActive: fullFor(m.id) ? m.lastActive : null,
      membershipType: m.membershipType, foundingMember: m.foundingMember,
      isHost:      m.clubMemberships.some(cm => cm.role === 'host'),
      // A private club's membership is for its members to know; connections
      // and staff see them all.
      // Which clubs someone HOSTS is public (they run the room); which ones
      // they merely belong to is for a connection — the same line the
      // profile route draws.
      clubs:       m.clubMemberships
                     .filter(cm => full ? true : cm.role === 'host' && !cm.club.isPrivate)
                     .map(({ club, role }) => ({ id: club.id, name: club.name, emoji: club.emoji, slug: club.slug, isHost: role === 'host' })),
      eventsCount: m._count.joinedEvents,
      // The three "open to" flags the card renders as ☕ 🗣️ 🏠 — selected
      // for the filter since it shipped, never actually returned, so those
      // pills could not appear on anybody.
      openToCoffee:   m.openToCoffee,
      openToLanguage: m.openToLanguage,
      openToHosting:  m.openToHosting,
      activePulse: pulseUserIds.has(m.id),
      restricted: false,
    }
  })

  return NextResponse.json({ members: result, total, hostTotal, adminTotal, savedTotal, hasMore: offset + PAGE_SIZE < total, isFiltered: isHost || adminOnly || savedOnly })
}
