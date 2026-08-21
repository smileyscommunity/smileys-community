import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getClubs } from '@/lib/db'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityTz } from '@/lib/city'
import { todayInTz } from '@/lib/cityTime'
import { classifyClubs } from '@/lib/clubHealth'

// Discovery payload (Clubs brief phase 3): the base club list enriched
// with computed health, this-week activity, upcoming-event counts and a
// few member faces per club. Viewer-independent by design — membership
// state comes from /api/clubs/memberships — so the whole payload caches
// as one shared entry.
const getDiscoveryClubs = unstable_cache(
  // cityId is part of the cache key (unstable_cache keys on its args) —
  // without it one city's cached grid would serve every city for 120s.
  async (today: string, weekOut: string, cityId: string) => {
    const clubs = await getClubs(cityId)
    const ids = clubs.map(c => c.id)
    const weekCutoff = new Date(Date.now() - 7 * 86_400_000)

    const [health, upcoming, weekEvents, weekPosts, weekHangs, faces] = await Promise.all([
      classifyClubs(ids),
      prisma.event.groupBy({
        by: ['clubId'],
        where: { clubId: { in: ids }, status: 'published', date: { gte: today } },
        _count: { _all: true },
      }),
      prisma.event.groupBy({
        by: ['clubId'],
        where: { clubId: { in: ids }, status: 'published', date: { gte: today, lte: weekOut } },
        _count: { _all: true },
      }),
      prisma.boardPost.groupBy({
        by: ['clubId'],
        where: { clubId: { in: ids }, status: 'active', createdAt: { gte: weekCutoff } },
        _count: { _all: true },
      }),
      prisma.hangout.groupBy({
        by: ['clubId'],
        where: { clubId: { in: ids }, createdAt: { gte: weekCutoff } },
        _count: { _all: true },
      }),
      // Four newest member faces per club in one window query — a
      // per-club take isn't expressible in the Prisma query API.
      prisma.$queryRaw<{ clubId: string; name: string; color: string; profilePhoto: string | null }[]>`
        SELECT x."clubId", u.name, u.color, u."profilePhoto"
        FROM (
          SELECT cm."clubId", cm."userId",
                 ROW_NUMBER() OVER (PARTITION BY cm."clubId" ORDER BY cm."joinedAt" DESC) AS rn
          FROM club_memberships cm
          WHERE cm.status = 'approved'
        ) x
        JOIN users u ON u.id = x."userId"
        WHERE x.rn <= 4 AND u.status = 'approved'
      `,
    ])

    const count = (rows: { clubId: string | null; _count: { _all: number } }[]) =>
      new Map(rows.filter(r => r.clubId).map(r => [r.clubId as string, r._count._all]))
    const up = count(upcoming), we = count(weekEvents), wp = count(weekPosts), wh = count(weekHangs)

    const facesByClub = new Map<string, { name: string; color: string; profilePhoto: string | null }[]>()
    for (const f of faces) {
      const list = facesByClub.get(f.clubId) ?? []
      list.push({ name: f.name, color: f.color, profilePhoto: f.profilePhoto })
      facesByClub.set(f.clubId, list)
    }

    return clubs.map(c => ({
      ...c,
      health:           health.get(c.id) ?? 'quiet',
      upcomingCount:    up.get(c.id) ?? 0,
      activityThisWeek: (we.get(c.id) ?? 0) + (wp.get(c.id) ?? 0) + (wh.get(c.id) ?? 0),
      faces:            facesByClub.get(c.id) ?? [],
    }))
  },
  ['clubs-discovery'],
  { revalidate: 120, tags: ['clubs'] },
)

export async function GET() {
  const session = await getSession()
  const cityId = await resolveCityId(session)
  // The city's own calendar decides "upcoming" and "this week" — a UTC
  // today undercounted upcoming events by a day for the first hours of
  // the city's morning. Both dates are cache-key args, so each city day
  // gets its own cached grid, same as before.
  const tz = await getCityTz(cityId)
  const today = todayInTz(tz)
  const weekOut = todayInTz(tz, 7)
  const clubs = await getDiscoveryClubs(today, weekOut, cityId)
  // The cached entry is viewer-independent by design, so the guest
  // projection is applied after retrieval: the club's WhatsApp invite
  // link is the payoff of joining — withheld from logged-out viewers,
  // matching /api/clubs/[slug].
  return NextResponse.json(session ? clubs : clubs.map(c => ({ ...c, whatsappUrl: null })))
}
