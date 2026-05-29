import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

const PAGE_SIZE = 100

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const offset    = parseInt(req.nextUrl.searchParams.get('offset') ?? '0') || 0
  const isHost    = req.nextUrl.searchParams.get('isHost') === 'true'
  const adminOnly = req.nextUrl.searchParams.get('adminOnly') === 'true'
  // ?openTo=coffee | language | hosting — narrows to members who've opted in.
  const openTo    = req.nextUrl.searchParams.get('openTo')
  // ?search= — case-insensitive substring match against name + neighborhood +
  // nationality. Without this the client-side filter could only find what
  // was already on screen, so a name beyond the first PAGE_SIZE rows of
  // joinedAt-desc never matched.
  const search    = req.nextUrl.searchParams.get('search')?.trim() ?? ''
  const openFilter =
    openTo === 'coffee'   ? { openToCoffee:   true } :
    openTo === 'language' ? { openToLanguage: true } :
    openTo === 'hosting'  ? { openToHosting:  true } :
    {}
  const searchFilter = search ? {
    OR: [
      { name:         { contains: search, mode: 'insensitive' as const } },
      { neighborhood: { contains: search, mode: 'insensitive' as const } },
      { nationality:  { contains: search, mode: 'insensitive' as const } },
    ],
  } : {}

  const roleIn = ['member', 'moderator', 'admin'] as string[]
  const where = {
    ...openFilter,
    ...searchFilter,
    ...(isHost
      ? { status: 'approved', role: { in: roleIn }, clubMemberships: { some: { role: 'host', status: 'approved' } } }
      : adminOnly
      ? { status: 'approved', role: 'admin' }
      : { status: 'approved', role: { in: roleIn } }),
  }

  // Get IDs the current user has blocked or is blocked by
  const blockRelations = await prisma.memberBlock.findMany({
    where: { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
    select: { blockerId: true, blockedId: true },
  })
  const blockedIds = new Set(blockRelations.map(b => b.blockerId === session.id ? b.blockedId : b.blockerId))

  const whereWithBlock = { ...where, id: { notIn: [...blockedIds] } }

  const [members, total, hostTotal, adminTotal] = await Promise.all([
    prisma.user.findMany({
      where: whereWithBlock,
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
    prisma.user.count({ where: whereWithBlock }),
    // Count users who are a host in at least one club
    prisma.user.count({
      where: {
        status: 'approved',
        clubMemberships: { some: { role: 'host', status: 'approved' } },
      },
    }),
    prisma.user.count({
      where: { status: 'approved', role: 'admin' },
    }),
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

  return NextResponse.json({ members: result, total, hostTotal, adminTotal, hasMore: offset + PAGE_SIZE < total, isFiltered: isHost || adminOnly })
}
