import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { todayIstanbul } from '@/lib/data'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`member-profile:${getIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = await params
  const today = todayIstanbul()

  const [user, upcomingEvents, connection] = await Promise.all([
    prisma.user.findFirst({
      where: { id, status: 'approved', role: { in: ['member', 'moderator', 'admin'] } },
      select: {
        id: true, name: true, color: true, bio: true,
        neighborhood: true, nationality: true, interests: true,
        languages: true, profilePhoto: true, joinedAt: true, role: true,
        instagram: true, socialStyles: true, lastActive: true,
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
        status: 'accepted',
        OR: [
          { requesterId: session.id, receiverId: id },
          { requesterId: id, receiverId: session.id },
        ],
      },
      select: { id: true },
    }),
  ])

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
    clubs:        user.clubMemberships.map(cm => cm.club),
    upcomingEvents,
    isConnected:  !!connection,
  })
}
