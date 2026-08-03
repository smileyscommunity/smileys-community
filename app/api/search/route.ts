import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { todayIstanbul } from '@/lib/data'
import { restrictedSetFor } from '@/lib/memberPrivacy'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`search:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ events: [], members: [], clubs: [], listings: [] })
  }

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2 || q.length > 100) return NextResponse.json({ events: [], members: [], clubs: [], listings: [] })

  const today = todayIstanbul()

  const blockRelations = await prisma.memberBlock.findMany({
    where: { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
    select: { blockerId: true, blockedId: true },
  })
  const blockedIds = blockRelations.map(b => b.blockerId === session.id ? b.blockedId : b.blockerId)

  const [events, members, clubs, listings] = await Promise.all([
    prisma.event.findMany({
      where: {
        status: 'published',
        date: { gte: today },
        title: { contains: q, mode: 'insensitive' },
      },
      select: { id: true, title: true, date: true, emoji: true, neighborhood: true },
      orderBy: { date: 'asc' },
      take: 5,
    }),
    prisma.user.findMany({
      where: {
        status: 'approved',
        id: { notIn: blockedIds },
        OR: [
          { name:         { contains: q, mode: 'insensitive' } },
          { neighborhood: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true, profileVisibility: true },
      take: 5,
    }),
    prisma.club.findMany({
      where: {
        isActive: true,
        name: { contains: q, mode: 'insensitive' },
      },
      select: { id: true, name: true, emoji: true, slug: true, memberCount: true },
      take: 5,
    }),
    prisma.listing.findMany({
      where: {
        status: 'active',
        OR: [
          { title:       { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, title: true, category: true, price: true, neighborhood: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ])

  // Flag 'connections only' members the viewer can't fully see so the
  // command palette can show a 🔒 hint. Strip profileVisibility from the
  // payload — the boolean is all the client needs.
  const restricted = await restrictedSetFor(session, members)
  const membersOut = members.map(({ profileVisibility, ...m }) => ({
    ...m,
    restricted: restricted.has(m.id),
  }))

  return NextResponse.json({ events, members: membersOut, clubs, listings })
}
