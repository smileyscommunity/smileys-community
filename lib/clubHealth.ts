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
export async function classifyClubs(clubIds: string[], now = new Date()): Promise<Map<string, ClubHealth>> {
  if (clubIds.length === 0) return new Map()
  const today = now.toISOString().split('T')[0]
  const cutoff = new Date(now.getTime() - 60 * 86_400_000)
  const cutoffDay = cutoff.toISOString().split('T')[0]

  const [clubs, upcoming, recent, convos, hangs] = await Promise.all([
    prisma.club.findMany({ where: { id: { in: clubIds } }, select: { id: true, isActive: true, createdAt: true } }),
    prisma.event.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, status: 'published', date: { gte: today } },
      _count: { _all: true },
    }),
    prisma.event.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, date: { gte: cutoffDay, lt: today } },
      _count: { _all: true },
    }),
    prisma.boardPost.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, status: 'active', createdAt: { gte: cutoff } },
      _count: { _all: true },
    }),
    prisma.hangout.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, createdAt: { gte: cutoff } },
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

// Discovery filter groups (brief §8) — a display-level consolidation of
// the 16 stored categories into 9 browseable filters. Club.category in
// the DB is untouched; renames happen here only. 'Exclusive' is a badge,
// not a browse group.
export const CLUB_FILTER_GROUPS: { value: string; label: string; categories: string[] }[] = [
  { value: 'social',       label: 'Social',            categories: ['Social', 'Nightlife'] },
  { value: 'outdoors',     label: 'Sports & Outdoors', categories: ['Sports', 'Outdoor'] },
  { value: 'food',         label: 'Food & Drink',      categories: ['Food & Drinks'] },
  { value: 'languages',    label: 'Languages',         categories: ['Language'] },
  { value: 'arts',         label: 'Arts & Culture',    categories: ['Creative', 'Culture'] },
  { value: 'professional', label: 'Professional',      categories: ['Networking', 'Business', 'Professional', 'Technology'] },
  { value: 'wellness',     label: 'Wellness',          categories: ['Wellness'] },
  { value: 'travel',       label: 'Travel',            categories: ['Travel'] },
  { value: 'volunteering', label: 'Volunteering',      categories: ['Volunteering'] },
]
