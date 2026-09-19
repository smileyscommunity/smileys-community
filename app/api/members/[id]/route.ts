import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { loadViewerFacts, sharedContextFor } from '@/lib/sharedContext'
import { rateLimit } from '@/lib/rateLimit'
import { isAdminOrModerator, isClubHost } from '@/lib/access'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'
import { todayInCity, resolveCityId } from '@/lib/city'
import { firstNameOf } from '@/lib/data'
import { countedReferralsWhere } from '@/lib/referrals'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Keyed on the member, not the address: a shared café or office Wi-Fi put
  // everyone behind one IP on one budget.
  if (!await rateLimit(`member-profile:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = await params
  const today = await todayInCity(await resolveCityId(session))

  const [user, upcomingEvents, connection, hangoutsHosted, hangoutsJoined, savedRow, activePulse, activeHangout] = await Promise.all([
    prisma.user.findFirst({
      where: { id, status: 'approved', role: { in: ['member', 'moderator', 'admin'] } },
      select: {
        id: true, name: true, color: true, bio: true,
        neighborhood: true, neighborhoodVisible: true, hiddenFromMembers: true, suspendedUntil: true,
        nationality: true, interests: true,
        languages: true, profilePhoto: true, joinedAt: true, role: true,
        instagram: true, linkedin: true, socialStyles: true, lastActive: true, profileVisibility: true, membershipType: true,
        foundingMember: true,
        referralCode: true,
        goodHangouts: true,
        industry: true, professionalRole: true, professionalStatus: true,
        clubMemberships: {
          where: { status: 'approved', role: 'host', club: { isActive: true } },
          select: { club: { select: { id: true, name: true, emoji: true, slug: true, bgColor: true, isPrivate: true } } },
        },
      },
    }),
    prisma.event.findMany({
      where: { hostId: id, status: 'published', date: { gte: today } },
      orderBy: { date: 'asc' },
      take: 6,
      select: { id: true, title: true, date: true, time: true, neighborhood: true, emoji: true, coverImage: true },
    }),
    prisma.memberConnection.findFirst({
      where: {
        // Declined rows are decline-memory (see /api/connections) — both
        // sides see "no connection here", so neither learns a decline
        // happened and the decliner keeps a working Connect button.
        status: { not: 'declined' },
        OR: [
          { requesterId: session.id, receiverId: id },
          { requesterId: id, receiverId: session.id },
        ],
      },
      select: { id: true, status: true, requesterId: true },
    }),
    // Hangouts hosted — exclude cancelled so a wash of cancellations
    // doesn't pad the number. Includes still-active ones.
    prisma.hangout.count({
      where: { userId: id, status: { in: ['active', 'expired'] } },
    }),
    // Hangouts joined — distinct hangout count via HangoutJoin.
    prisma.hangoutJoin.count({ where: { userId: id } }),
    // Whether the current viewer has saved this member.
    session.id !== id
      ? prisma.memberSave.findUnique({
          where: { userId_savedId: { userId: session.id, savedId: id } },
          select: { savedId: true },
        })
      : Promise.resolve(null),
    // Active availability pulse — powers a live "free to meet now" badge on
    // the profile while the member's pulse hasn't expired (until >= now).
    prisma.availabilityPulse.findFirst({
      where:   { userId: id, until: { gte: new Date() } },
      orderBy: { until: 'desc' },
      select:  { neighborhood: true, note: true, until: true },
    }),
    // Active hangout this member is hosting right now — powers a live
    // "hosting a hangout now" badge alongside the pulse badge.
    prisma.hangout.findFirst({
      // Started and not yet ended — one planned for tonight isn't "now".
      where:   { userId: id, status: 'active', startsAt: { lte: new Date() }, endsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      select:  { id: true, title: true, neighborhood: true, startsAt: true },
    }),
  ])

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const self = session.id === id
  const staff = isAdminOrModerator(session)
  // A suspended member is off the member surfaces until it lifts; a blocked
  // pair never sees each other. 404 either way so neither can tell which.
  // Hidden (hiddenFromMembers) means unlisted, not unreachable: those members
  // keep full access, and their connections, DM partners and hangout joiners
  // still open their profile from a direct link.
  if (!self && !staff) {
    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (await isBlockedEitherWay(session.id, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  // Three levels, the same ones the directory list uses:
  //   full   — self, an accepted connection, staff or a club host: everything.
  //   member — a public profile seen by another member: who they are (full
  //            name, photo, bio, interests, the clubs they host) but not
  //            how to reach them — Instagram, LinkedIn and work details are
  //            for connections.
  //   locked — a connections-only profile seen by someone not connected:
  //            first name and the connection state only. It used to be a
  //            404, which left the receiver of a request from a private
  //            member with nothing to accept it from.
  const privileged = staff || await isClubHost(session.id)
  const connected = connection?.status === 'accepted'
  const viewLevel: 'full' | 'member' | 'locked' =
    self || connected || privileged ? 'full'
    : user.profileVisibility === 'connections' ? 'locked'
    : 'member'
  const fullAccess = viewLevel === 'full'

  recordView(session, id, self)

  if (viewLevel === 'locked') {
    return NextResponse.json({
      id: user.id,
      name: firstNameOf(user.name),
      color: user.color,
      profilePhoto: null,
      viewLevel,
      viewerHasFullProfile: false,
      bio: null, neighborhood: null, nationality: null, interests: [], languages: [], socialStyles: [],
      joinedAt: null, role: null, membershipType: null, foundingMember: false,
      instagram: null, linkedin: null, industry: null, professionalRole: null, professionalStatus: null,
      clubs: [], upcomingEvents: [], sharedContext: null,
      isConnected: false,
      connectionId: connection?.id ?? null,
      connectionStatus: connection?.status ?? null,
      connectionIsRequester: connection ? connection.requesterId === session.id : null,
      goodHangouts: 0, hangoutsHosted: 0, hangoutsJoined: 0, broughtInCount: 0,
      isSaved: savedRow !== null,
      activePulse: null, activeHangout: null,
    })
  }

  // Shared context (Members brief §28) — deliberately NOT behind
  // fullAccess. Every fact here is an INTERSECTION with something the
  // viewer already knows about themselves: a club they're in, their own
  // neighborhood, an event they're attending, an interest they listed.
  // It reveals no new attribute of the member, and it's the entire
  // reason a non-connected viewer would have to reach out — gating it
  // would leave "Connect" with nothing to say. Never computed for the
  // viewer's own profile.
  const sharedCtx = self ? null : await (async () => {
    const viewer = await loadViewerFacts(session.id)
    const map = await sharedContextFor(viewer, [id])
    const c = map.get(id)
    if (!c) return null
    return {
      clubs: c.clubs,
      neighborhood: c.neighborhood,
      events: c.events,
      hangouts: c.hangouts,
      interests: c.interests,
    }
  })()

  // Count of approved members this user brought in — drives the
  // "🤝 Brought in N members" trust badge on the profile. Derived
  // (not from the User.referralCount column) so it stays accurate
  // after status churn. Skips the count entirely when the user has
  // no referralCode yet — most users never generate one.
  const broughtInCount = user.referralCode
    ? await prisma.memberApplication.count({ where: countedReferralsWhere(user.referralCode) })
    : 0

  return NextResponse.json({
    id:           user.id,
    name:         user.name,
    color:        user.color,
    bio:          user.bio,
    // Where they live is shown only if they chose to be listed by it.
    neighborhood: fullAccess || user.neighborhoodVisible ? user.neighborhood : null,
    nationality:  user.nationality,
    interests:    user.interests,
    languages:    user.languages,
    socialStyles: user.socialStyles,
    profilePhoto: user.profilePhoto,
    joinedAt:     user.joinedAt,
    role:         user.role,
    membershipType: user.membershipType,
    foundingMember: user.foundingMember,
    instagram:    fullAccess ? user.instagram : null,
    linkedin:     fullAccess ? user.linkedin : null,
    // Professional fields surfaced only when the member opted in to a
    // non-social_only status. Treating null/social_only the same way
    // — neither leaks the industry/role to viewers — keeps the social
    // surface clean by default.
    industry:           fullAccess && user.professionalStatus && user.professionalStatus !== 'social_only' ? user.industry           : null,
    professionalRole:   fullAccess && user.professionalStatus && user.professionalStatus !== 'social_only' ? user.professionalRole   : null,
    professionalStatus: fullAccess && user.professionalStatus && user.professionalStatus !== 'social_only' ? user.professionalStatus : null,
    // A private club's name is for its members; staff and connections see them all.
    clubs:        user.clubMemberships.map(cm => cm.club)
                    .filter(c => fullAccess || !c.isPrivate)
                    .map(c => ({ id: c.id, name: c.name, emoji: c.emoji, slug: c.slug, bgColor: c.bgColor })),
    upcomingEvents,
    viewLevel,
    // True when the viewer sees the ungated profile (self / connected /
    // admin / moderator / club host) — drives the lock notice client-side.
    viewerHasFullProfile: fullAccess,
    sharedContext: sharedCtx,
    isConnected:     connection?.status === 'accepted',
    connectionId:    connection?.id ?? null,
    connectionStatus: connection?.status ?? null,
    connectionIsRequester: connection ? connection.requesterId === session.id : null,
    // Hangout stats — for the profile counter + trust badge.
    goodHangouts: user.goodHangouts,
    hangoutsHosted,
    hangoutsJoined,
    // Referral signal — only included when non-zero so the front-end
    // doesn't render a "Brought in 0" badge that would actively shame
    // members who haven't invited anyone yet.
    broughtInCount,
    isSaved: savedRow !== null,
    // Live "free to meet now" signal — null unless the member has a
    // non-expired availability pulse.
    // Where and the free-text note follow the same gate as `neighborhood`
    // above; the fact that they are free right now does not.
    activePulse: activePulse
      ? { neighborhood: fullAccess || user.neighborhoodVisible ? activePulse.neighborhood : null, note: fullAccess ? activePulse.note : null, until: activePulse.until }
      : null,
    // Live "hosting a hangout now" signal — null unless they have an active
    // hangout that hasn't ended.
    activeHangout: activeHangout
      ? { id: activeHangout.id, title: activeHangout.title, neighborhood: activeHangout.neighborhood, startsAt: activeHangout.startsAt }
      : null,
  })
}

// The member's own /profile-visitors list. Nobody is notified of a view any
// more — "someone viewed your profile" is the kind of nudge that brings
// people back to check who, not out to meet anyone. Staff and club hosts
// open profiles to do their jobs, and a hidden account isn't on the member
// surfaces, so none of them land on anyone's visitor list.
function recordView(session: { id: string; role: string }, viewedId: string, self: boolean) {
  if (self || isAdminOrModerator(session as never)) return
  void (async () => {
    const viewer = await prisma.user.findUnique({ where: { id: session.id }, select: { hiddenFromMembers: true } })
    if (!viewer || viewer.hiddenFromMembers || await isClubHost(session.id)) return
    await prisma.profileView.upsert({
      where:  { viewerId_viewedId: { viewerId: session.id, viewedId } },
      create: { viewerId: session.id, viewedId },
      update: { createdAt: new Date() },
    })
  })().catch(() => {})
}
