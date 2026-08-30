// Club health classification (Clubs brief §36) — computed, never stored:
// health changes as activity changes, and a stored flag would need its own
// sweeper. Discovery ranks Active > New > Quiet; Archived (isActive=false)
// never surfaces outside admin.
//
// The audit found ~75% of the 162 clubs dormant (regional seeding), so
// honest classification is what keeps discovery credible — per the brief:
// "Do not fake activity."
import { prisma } from './prisma'

export type ClubHealth = 'active' | 'new' | 'quiet' | 'archived'

export interface ClubHealthSignals {
  isActive: boolean
  createdAt: Date
  upcomingEvents: number
  recentEvents: number      // events in the last 60 days
  recentConversations: number // board posts tagged to the club, last 60 days
  recentHangouts: number    // club-shared hangouts, last 60 days
}

export function classifyClub(s: ClubHealthSignals, now = new Date()): ClubHealth {
  if (!s.isActive) return 'archived'
  if (s.upcomingEvents > 0 || s.recentEvents > 0 || s.recentConversations > 0 || s.recentHangouts > 0) return 'active'
  // "New" = created in the last 60 days with no activity yet — gets the
  // benefit of the doubt in discovery instead of an instant "quiet" label.
  if (now.getTime() - s.createdAt.getTime() < 60 * 86_400_000) return 'new'
  return 'quiet'
}

// Batch signals for a set of clubs in three grouped queries (not N+1).
// Returns a map clubId -> health.
//
// `cityId` scopes the activity signals to one city. It matters for global
// clubs (Club.cityId null), which are listed in every opted-in city's grid:
// unscoped, Istanbul's events and board posts made the Language clubs read
// as "Active" on Bodrum's grid, where nothing has ever happened. Pass the
// city whose grid is being ranked. Omit it only when the candidate set
// itself isn't city-scoped (a global club's related-clubs list), so the
// health matches what's being ranked.
export async function classifyClubs(
  clubIds: string[],
  cityId?: string | null,
  now = new Date(),
): Promise<Map<string, ClubHealth>> {
  if (clubIds.length === 0) return new Map()
  const today = now.toISOString().split('T')[0]
  const cutoff = new Date(now.getTime() - 60 * 86_400_000)
  const cutoffDay = cutoff.toISOString().split('T')[0]
  const inCity = cityId ? { cityId } : {}

  const [clubs, upcoming, recent, convos, hangs] = await Promise.all([
    prisma.club.findMany({ where: { id: { in: clubIds } }, select: { id: true, isActive: true, createdAt: true } }),
    prisma.event.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, status: 'published', date: { gte: today }, ...inCity },
      _count: { _all: true },
    }),
    prisma.event.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, date: { gte: cutoffDay, lt: today }, ...inCity },
      _count: { _all: true },
    }),
    prisma.boardPost.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, status: 'active', createdAt: { gte: cutoff }, ...inCity },
      _count: { _all: true },
    }),
    prisma.hangout.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, createdAt: { gte: cutoff }, ...inCity },
      _count: { _all: true },
    }),
  ])

  const count = (rows: { clubId: string | null; _count: { _all: number } }[]) =>
    new Map(rows.filter(r => r.clubId).map(r => [r.clubId as string, r._count._all]))
  const up = count(upcoming), re = count(recent), co = count(convos), ha = count(hangs)

  return new Map(clubs.map(c => [c.id, classifyClub({
    isActive: c.isActive,
    createdAt: c.createdAt,
    upcomingEvents:      up.get(c.id) ?? 0,
    recentEvents:        re.get(c.id) ?? 0,
    recentConversations: co.get(c.id) ?? 0,
    recentHangouts:      ha.get(c.id) ?? 0,
  }, now)]))
}

// Discovery filter groups moved to lib/clubDiscovery (client-safe — no
// prisma import); re-exported here so server callers and tests keep one
// import site.
export { CLUB_FILTER_GROUPS } from './clubDiscovery'
