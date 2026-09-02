import { prisma } from '@/lib/prisma'
import { getStatsFor, CITY_STATUS } from '@/lib/cities'

// ── The ops signal for a live city that isn't moving ────────────────────────
//
// Status says a city is open; maturity says whether it is alive. Neither
// makes anyone look. This is the look: every LIVE city with nothing on its
// calendar, with how long it has been live, on the admin dashboard next to
// the other "needs a human" pills. Three live cities had no upcoming event
// between them on 2026-09-03 and nothing in the panel said so.
//
// "Live since" comes from the audit trail (the status change to live), which
// is honest for every city launched after the audit log existed; the city's
// createdAt is the fallback. Stalled is a stage, not a score: under a month
// is normal for a founding city, past it the pill turns red.

const DAY = 24 * 60 * 60 * 1000

export const STALLED_RED_AFTER_DAYS = 30

export interface StalledCity {
  id:             string
  slug:           string
  name:           string
  members:        number
  upcomingEvents: number
  daysLive:       number
  maturity:       string
}

/** Days since `liveSince`, whole, never negative. */
export function daysSince(liveSince: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - liveSince.getTime()) / DAY))
}

/** A live city with no upcoming published event is stalled, whatever else it has. */
export function isStalled(s: { upcomingEvents: number }): boolean {
  return s.upcomingEvents === 0
}

/** Pill severity: a founding city gets a month before the colour changes. */
export function stalledSeverity(daysLive: number): 'amber' | 'red' {
  return daysLive >= STALLED_RED_AFTER_DAYS ? 'red' : 'amber'
}

/** One line per stalled city, for the dashboard pill. */
export function describeStalled(c: Pick<StalledCity, 'name' | 'members' | 'daysLive'>): string {
  return `${c.name} (${c.members} member${c.members === 1 ? '' : 's'} · no upcoming event · live ${c.daysLive}d)`
}

/**
 * Live cities with nothing on the calendar, oldest-stalled first. `cityIds`
 * narrows it (a moderator's own city); omit for every live city.
 */
export async function stalledLiveCities(now: Date = new Date(), cityIds?: string[]): Promise<StalledCity[]> {
  const cities = await prisma.city.findMany({
    where:  { status: CITY_STATUS.Live, ...(cityIds ? { id: { in: cityIds } } : {}) },
    select: { id: true, slug: true, name: true, createdAt: true },
  })
  if (cities.length === 0) return []
  const [stats, liveRows] = await Promise.all([
    getStatsFor(cities.map(c => c.id)),
    prisma.auditLog.findMany({
      where:   { action: 'city.status_change', targetType: 'city', targetId: { in: cities.map(c => c.id) } },
      orderBy: { createdAt: 'desc' },
      select:  { targetId: true, meta: true, createdAt: true },
    }),
  ])
  // Latest "→ live" transition per city.
  const liveSince = new Map<string, Date>()
  for (const r of liveRows) {
    const to = (r.meta as { to?: string } | null)?.to
    if (to === CITY_STATUS.Live && r.targetId && !liveSince.has(r.targetId)) liveSince.set(r.targetId, r.createdAt)
  }
  return cities.flatMap(c => {
    const s = stats.get(c.id)
    if (!s || !isStalled({ upcomingEvents: s.events })) return []
    return [{
      id: c.id, slug: c.slug, name: c.name,
      members: s.members, upcomingEvents: s.events,
      daysLive: daysSince(liveSince.get(c.id) ?? c.createdAt, now),
      maturity: s.maturity,
    }]
  }).sort((a, b) => b.daysLive - a.daysLive)
}
