import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { todayInCity, resolveCityId } from '@/lib/city'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`club-feed:${session.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const memberships = await prisma.clubMembership.findMany({
    where: { userId: session.id, status: 'approved' },
    select: { clubId: true, club: { select: { id: true, name: true, emoji: true, slug: true } } },
  })

  if (!memberships.length) return NextResponse.json({ items: [] })

  const clubIds = memberships.map(m => m.clubId)
  const clubMap = Object.fromEntries(memberships.map(m => [m.clubId, m.club]))

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  // Istanbul date, not UTC — between 00:00–03:00 Istanbul UTC is still the
  // previous calendar day, so a UTC "today" showed events that already
  // happened in Istanbul as upcoming. Every other date compare uses this.
  const today  = await todayInCity(await resolveCityId(session))

  const [events, posts] = await Promise.all([
    prisma.event.findMany({
      where: { clubId: { in: clubIds }, status: 'published', date: { gte: today } },
      select: {
        id: true, title: true, emoji: true, date: true, time: true,
        neighborhood: true, clubId: true, createdAt: true,
        totalSpots: true, spotsLeft: true, price: true,
      },
      orderBy: { date: 'asc' },
      take: 15,
    }),
    prisma.clubPost.findMany({
      where: { clubId: { in: clubIds }, createdAt: { gte: cutoff }, type: { in: ['post', 'announcement'] } },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  const items = [
    ...events.map(e => ({
      type: 'event',
      id: e.id,
      club: clubMap[e.clubId!] ?? { id: e.clubId, name: '', emoji: '', slug: '' },
      createdAt: e.createdAt.toISOString(),
      sortDate: e.date,
      title: e.title, emoji: e.emoji, date: e.date, time: e.time,
      neighborhood: e.neighborhood, totalSpots: e.totalSpots,
      spotsLeft: e.spotsLeft, price: e.price,
    })),
    ...posts.map(p => ({
      type: p.type === 'announcement' ? 'announcement' : 'post',
      id: p.id,
      club: clubMap[p.clubId] ?? { id: p.clubId, name: '', emoji: '', slug: '' },
      createdAt: p.createdAt.toISOString(),
      sortDate: p.createdAt.toISOString().split('T')[0],
      content: p.content, isPinned: p.isPinned,
      author: { id: p.user.id, name: p.user.name, color: p.user.color, photo: p.user.profilePhoto },
    })),
  ].sort((a, b) => {
    // Events by event date asc, posts by createdAt desc — interleave with posts first
    if (a.type === 'event' && b.type !== 'event') return 1
    if (a.type !== 'event' && b.type === 'event') return -1
    if (a.type === 'event' && b.type === 'event') return a.sortDate < b.sortDate ? -1 : 1
    return a.createdAt > b.createdAt ? -1 : 1
  })

  return NextResponse.json({ items })
}
