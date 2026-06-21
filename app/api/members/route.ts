import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { isAdminOrModerator, isClubHost } from '@/lib/access'

const PAGE_SIZE = 100

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`members:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const offset    = parseInt(req.nextUrl.searchParams.get('offset') ?? '0') || 0
  const isHost    = req.nextUrl.searchParams.get('isHost') === 'true'
  const adminOnly = req.nextUrl.searchParams.get('adminOnly') === 'true'
  const savedOnly = req.nextUrl.searchParams.get('savedOnly') === 'true'
  const openTo    = req.nextUrl.searchParams.get('openTo')
  const search    = req.nextUrl.searchParams.get('search')?.trim() ?? ''

  const openFilter: Prisma.UserWhereInput =
    openTo === 'coffee'   ? { openToCoffee:   true } :
    openTo === 'language' ? { openToLanguage: true } :
    openTo === 'hosting'  ? { openToHosting:  true } :
    {}

  const searchFilter: Prisma.UserWhereInput = search ? {
    OR: [
      { name:         { contains: search, mode: 'insensitive' } },
      { neighborhood: { contains: search, mode: 'insensitive' } },
      { nationality:  { contains: search, mode: 'insensitive' } },
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

  // Hard reciprocity: a viewer who hides their own profile
  // ('connections only') only sees their connections in the directory.
  // Hiding yourself also hides everyone else from you, so privacy isn't
  // a one-way mirror. For 'everyone' viewers this filter is a no-op.
  //
  // Admins, moderators, and club hosts are exempt — they need full
  // directory access for moderation / event management regardless of
  // their own privacy setting.
  const viewer = await prisma.user.findUnique({
    where:  { id: session.id },
    select: { profileVisibility: true },
  })
  let reciprocityFilter: Prisma.UserWhereInput = {}
  if (viewer?.profileVisibility === 'connections'
      && !isAdminOrModerator(session)
      && !(await isClubHost(session.id))) {
    const conns = await prisma.memberConnection.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: session.id }, { receiverId: session.id }],
      },
      select: { requesterId: true, receiverId: true },
    })
    const connectionIds = conns.map(c => c.requesterId === session.id ? c.receiverId : c.requesterId)
    reciprocityFilter = { id: { in: [...connectionIds, session.id] } }
  }

  const roleIn = ['member', 'moderator', 'admin']

  // Build the full where — each clause is ANDed together by Prisma's default.
  // Using an explicit AND array avoids TypeScript inference issues when mixing
  // OR/NOT with dynamic conditions at the same level.
  const where: Prisma.UserWhereInput = {
    AND: [
      // Exclude members who've set profileVisibility:'connections' — they
      // opted out of general member discovery. Always include the viewer.
      {
        OR: [
          { profileVisibility: 'everyone' },
          { id: session.id },
        ],
      },
      // Exclude blocked users (and users who blocked the viewer).
      blockedIds.length > 0 ? { id: { notIn: blockedIds } } : {},
      // Reciprocity: restrict hidden viewers to their connections.
      reciprocityFilter,
      openFilter,
      searchFilter,
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
        instagram: true, lastActive: true, socialStyles: true,
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
        AND: [
          reciprocityFilter,
          {
            status: 'approved',
            clubMemberships: { some: { role: 'host', status: 'approved' } },
          },
        ],
      },
    }),
    prisma.user.count({
      where: { AND: [reciprocityFilter, { status: 'approved', role: 'admin' }] },
    }),
    prisma.memberSave.count({ where: { userId: session.id } }),
  ])

  const result = members.map(m => ({
    id: m.id, name: m.name, color: m.color, bio: m.bio,
    neighborhood: m.neighborhood, nationality: m.nationality,
    interests: m.interests, languages: m.languages,
    socialStyles: m.socialStyles,
    profilePhoto: m.profilePhoto, joinedAt: m.joinedAt,
    role: m.role, instagram: m.instagram, lastActive: m.lastActive,
    isHost:      m.clubMemberships.some(cm => cm.role === 'host'),
    clubs:       m.clubMemberships.map(cm => ({ ...cm.club, isHost: cm.role === 'host' })),
    eventsCount: m._count.joinedEvents,
  }))

  return NextResponse.json({ members: result, total, hostTotal, adminTotal, savedTotal, hasMore: offset + PAGE_SIZE < total, isFiltered: isHost || adminOnly || savedOnly })
}
