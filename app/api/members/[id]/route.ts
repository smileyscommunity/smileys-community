import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { todayIstanbul } from '@/lib/data'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { isAdminOrModerator, isClubHost } from '@/lib/access'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`member-profile:${getIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = await params
  const today = todayIstanbul()

  const [user, upcomingEvents, connection, hangoutsHosted, hangoutsJoined, savedRow] = await Promise.all([
    prisma.user.findFirst({
      where: { id, status: 'approved', role: { in: ['member', 'moderator', 'admin'] } },
      select: {
        id: true, name: true, color: true, bio: true,
        neighborhood: true, nationality: true, interests: true,
        languages: true, profilePhoto: true, joinedAt: true, role: true,
        instagram: true, socialStyles: true, lastActive: true, profileVisibility: true,
        referralCode: true,
        goodHangouts: true,
        industry: true, professionalRole: true, professionalStatus: true,
        clubMemberships: {
          where: { status: 'approved', role: 'host' },
          select: { club: { select: { id: true, name: true, emoji: true, slug: true, bgColor: true } } },
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
  ])

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Private-account model: a 'connections only' member's full profile is
  // gated. Viewing your own always works; everyone else needs an accepted
  // MemberConnection. Admins, moderators, and club hosts are exempt
  // (moderation / event management). 404 rather than 403 so the viewer
  // can't tell whether the profile exists. Reuses the connection row
  // already fetched above — no extra query.
  if (
    session.id !== id &&
    user.profileVisibility === 'connections' &&
    connection?.status !== 'accepted' &&
    !isAdminOrModerator(session) &&
    !(await isClubHost(session.id))
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Count of approved members this user brought in — drives the
  // "🤝 Brought in N members" trust badge on the profile. Derived
  // (not from the User.referralCount column) so it stays accurate
  // after status churn. Skips the count entirely when the user has
  // no referralCode yet — most users never generate one.
  const broughtInCount = user.referralCode
    ? await prisma.memberApplication.count({
        where: { referredBy: user.referralCode, status: { in: ['approved', 'active'] } },
      })
    : 0

  // Block check — return 404 so blocker/blocked don't know they're blocked
  if (session.id !== id) {
    const blocked = await prisma.memberBlock.findFirst({
      where: { OR: [{ blockerId: session.id, blockedId: id }, { blockerId: id, blockedId: session.id }] },
    })
    if (blocked) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Record profile view (fire-and-forget, skip own profile)
  if (session.id !== id) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    prisma.profileView.findUnique({
      where: { viewerId_viewedId: { viewerId: session.id, viewedId: id } },
      select: { createdAt: true },
    }).then(existing => {
      const isFirstView = !existing
      prisma.profileView.upsert({
        where: { viewerId_viewedId: { viewerId: session.id, viewedId: id } },
        create: { viewerId: session.id, viewedId: id },
        update: { createdAt: new Date() },
      }).then(() => {
        // Notify profile owner only on first view or if last view was > 24h ago
        if (isFirstView || (existing && existing.createdAt < oneDayAgo)) {
          createNotification(id, 'profile_view', 'Someone viewed your profile 👀',
            'A member just looked at your profile.', '/profile-visitors')
        }
      }).catch(() => {})
    }).catch(() => {})
  }

  return NextResponse.json({
    id:           user.id,
    name:         user.name,
    color:        user.color,
    bio:          user.bio,
    neighborhood: user.neighborhood,
    nationality:  user.nationality,
    interests:    user.interests,
    languages:    user.languages,
    socialStyles: user.socialStyles,
    profilePhoto: user.profilePhoto,
    joinedAt:     user.joinedAt,
    role:         user.role,
    instagram:    user.instagram,
    // Professional fields surfaced only when the member opted in to a
    // non-social_only status. Treating null/social_only the same way
    // — neither leaks the industry/role to viewers — keeps the social
    // surface clean by default.
    industry:           user.professionalStatus && user.professionalStatus !== 'social_only' ? user.industry           : null,
    professionalRole:   user.professionalStatus && user.professionalStatus !== 'social_only' ? user.professionalRole   : null,
    professionalStatus: user.professionalStatus && user.professionalStatus !== 'social_only' ? user.professionalStatus : null,
    clubs:        user.clubMemberships.map(cm => cm.club),
    upcomingEvents,
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
  })
}
