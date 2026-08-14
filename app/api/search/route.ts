import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { rateLimit } from '@/lib/rateLimit'
import { todayIstanbul } from '@/lib/data'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import { categoryMeta } from '@/lib/handbook-categories'

const EMPTY = { events: [], members: [], clubs: [], listings: [], handbook: [] }

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`search:${session.id}`, 30, 60_000)) {
    return NextResponse.json(EMPTY)
  }

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2 || q.length > 100) return NextResponse.json(EMPTY)

  const today = todayIstanbul()

  const blockRelations = await prisma.memberBlock.findMany({
    where: { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
    select: { blockerId: true, blockedId: true },
  })
  const blockedIds = blockRelations.map(b => b.blockerId === session.id ? b.blockedId : b.blockerId)

  // Handbook articles match on title, excerpt, or the tags array. Raw SQL
  // because Prisma's array `has` is exact-element-only — "vergi" must match
  // the tag "vergi numarası", which needs a contains over the joined tags.
  // The pattern is passed as a bound parameter (Prisma.sql), never
  // interpolated, so `q` can't inject; %/_ in the query are treated as
  // wildcards, which for search is behaviour, not a bug.
  // Search is scoped to the viewer's city. Handbook articles with a null
  // cityId are global (apply everywhere) and always match.
  const cityId = await resolveCityId(session)

  const pattern = `%${q}%`
  const handbookQuery = prisma.$queryRaw<
    { id: string; slug: string; title: string; excerpt: string | null; category: string }[]
  >(Prisma.sql`
    SELECT id, slug, title, excerpt, category
    FROM posts
    WHERE kind = 'handbook' AND status = 'published'
      AND ("cityId" IS NULL OR "cityId" = ${cityId})
      AND (title ILIKE ${pattern} OR excerpt ILIKE ${pattern}
           OR array_to_string(tags, ' ') ILIKE ${pattern})
    ORDER BY views DESC
    LIMIT 5
  `)

  const [events, members, clubs, listings, handbookRows] = await Promise.all([
    prisma.event.findMany({
      where: {
        status: 'published',
        cityId,
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
        cityId,
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
        cityId,
        name: { contains: q, mode: 'insensitive' },
      },
      select: { id: true, name: true, emoji: true, slug: true, memberCount: true },
      take: 5,
    }),
    prisma.listing.findMany({
      where: {
        status: 'active',
        cityId,
        OR: [
          { title:       { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, title: true, category: true, price: true, neighborhood: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    handbookQuery,
  ])

  // Resolve stored (possibly legacy) category keys to the canonical label +
  // emoji so the palette shows "Residence & Legal", not "Bureaucracy".
  const handbook = handbookRows.map(h => {
    const meta = categoryMeta(h.category)
    return {
      slug:     h.slug,
      title:    h.title,
      excerpt:  h.excerpt,
      category: meta?.label ?? h.category,
      emoji:    meta?.emoji ?? '📖',
    }
  })

  // Flag 'connections only' members the viewer can't fully see so the
  // command palette can show a 🔒 hint. Strip profileVisibility from the
  // payload — the boolean is all the client needs.
  const restricted = await restrictedSetFor(session, members)
  const membersOut = members.map(({ profileVisibility, ...m }) => ({
    ...m,
    restricted: restricted.has(m.id),
  }))

  return NextResponse.json({ events, members: membersOut, clubs, listings, handbook })
}
