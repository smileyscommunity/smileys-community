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

    // Every signal below is city-scoped, for the same reason the two member
    // counts in getClubs are: a global club (Club.cityId null) is listed in
    // every opted-in city's grid, so a network-wide count describes a
    // community the viewer can't reach. Unscoped, Bodrum's grid credited the
    // Iranian club with Istanbul's two upcoming events, ranked the Language
    // clubs "Active this week" on Istanbul's board posts, and showed four
    // Istanbul faces as if they were the local members. For a city-scoped
    // club the filter is a no-op — its events, posts and hangouts are all in
    // its own city.
    const [health, upcoming, weekEvents, weekPosts, weekHangs, faces] = await Promise.all([
      classifyClubs(ids, cityId),
      prisma.event.groupBy({
        by: ['clubId'],
        where: { clubId: { in: ids }, status: 'published', date: { gte: today }, cityId },
        _count: { _all: true },
      }),
      prisma.event.groupBy({
        by: ['clubId'],
        where: { clubId: { in: ids }, status: 'published', date: { gte: today, lte: weekOut }, cityId },
        _count: { _all: true },
      }),
      prisma.boardPost.groupBy({
        by: ['clubId'],
        where: { clubId: { in: ids }, status: 'active', createdAt: { gte: weekCutoff }, cityId },
        _count: { _all: true },
      }),
      prisma.hangout.groupBy({
        by: ['clubId'],
        where: { clubId: { in: ids }, createdAt: { gte: weekCutoff }, cityId },
        _count: { _all: true },
      }),
      // Four newest member faces per club in one window query — a
      // per-club take isn't expressible in the Prisma query API.
      //
      // The city filter has to sit INSIDE the window, not after it: ranking
      // every member and then dropping the non-local ones would leave a
      // global club faceless in Bodrum whenever its four newest joins are
      // Istanbul's, even with local members further down the list.
      prisma.$queryRaw<{ clubId: string; name: string; color: string; profilePhoto: string | null }[]>`
        SELECT x."clubId", x.name, x.color, x."profilePhoto"
        FROM (
          SELECT cm."clubId", u.name, u.color, u."profilePhoto",
                 ROW_NUMBER() OVER (PARTITION BY cm."clubId" ORDER BY cm."joinedAt" DESC) AS rn
          FROM club_memberships cm
          JOIN users u ON u.id = cm."userId"
          WHERE cm.status = 'approved' AND u.status = 'approved' AND u."cityId" = ${cityId}
        ) x
        WHERE x.rn <= 4
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
