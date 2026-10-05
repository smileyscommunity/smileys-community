import { unstable_cache, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { todayInTz } from '@/lib/cityTime'
import { blockedIdsFor, restrictedSetFor } from '@/lib/memberPrivacy'
import type { SessionUser } from '@/lib/session'
import { rankHosts, projectRosterForViewer, projectHostForGuest, type RosterHost } from '@/lib/hostTitles'

// A city's hosts, as a public roster: who they are, what they hold (Host /
// City Lead — lib/hostTitles), the clubs they run and how much they host.
// Shared by /hosts, /[city]/hosts and the city page's Meet your hosts
// section so the three can't drift. Cached raw and unredacted; the caller
// runs projectRosterForViewer per request, because a viewer-dependent shape
// must never enter unstable_cache (the rule in app/[city]/data.ts).
//
// Exactly the tier of information every public event card already carries
// and nothing more: no bio, no contact, no quality metrics — wouldReturnRate
// is a moderation diagnostic, not a leaderboard (see EventSurvey's schema
// comment), and a public ranking would corrupt it.

export const HOST_ROSTER_TAG = 'hosts'

export const getCityHostRoster = unstable_cache(
  async (cityId: string, timezone: string): Promise<RosterHost[]> => {
    // The city's own day, not the founding city's: "upcoming" for a Tbilisi
    // host used to roll over on Istanbul's clock.
    const today = todayInTz(timezone)
    // A suspension leaves status 'approved' and sets a date, so it needs its
    // own gate — the members directory's (app/api/members). Without it a
    // suspended host kept their card, photo and a profile link that 404'd.
    const listable = {
      status: 'approved' as const, hiddenFromMembers: false,
      OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
    }

    // Two ways in: hosting a club, or a city-level grant. Union them — most
    // leads also host a club, and either alone belongs on the roster. A
    // global club (cityId null — a third of the active clubs) has no city
    // to list its hosts under, so they count for the city they live in:
    // six hosts, two of Istanbul's last 38 events, were on no roster at all.
    const [clubHostRows, cityHostRows] = await Promise.all([
      prisma.clubMembership.findMany({
        where: {
          role: 'host', status: 'approved',
          user: listable,
          OR: [
            { club: { isActive: true, cityId } },
            { club: { isActive: true, cityId: null }, user: { cityId } },
          ],
        },
        select: {
          userId: true,
          club: { select: { id: true, name: true, slug: true, emoji: true } },
          user: { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },
        },
      }),
      prisma.cityHost.findMany({
        where: {
          cityId, status: 'approved', revokedAt: null,
          user: listable,
        },
        select: { user: { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } } },
      }),
    ])

    const hosts = new Map<string, RosterHost>()
    for (const row of clubHostRows) {
      const h = hosts.get(row.userId) ?? { ...row.user, title: 'host' as const, clubs: [], upcomingCount: 0, hostedCount: 0 }
      h.clubs.push(row.club)
      hosts.set(row.userId, h)
    }
    for (const row of cityHostRows) {
      const h = hosts.get(row.user.id) ?? { ...row.user, title: 'host' as const, clubs: [], upcomingCount: 0, hostedCount: 0 }
      h.title = 'lead'
      hosts.set(row.user.id, h)
    }
    if (hosts.size === 0) return []

    const hostIds = [...hosts.keys()]
    const [upcoming, past] = await Promise.all([
      prisma.event.groupBy({
        by: ['hostId'],
        where: { hostId: { in: hostIds }, cityId, status: 'published', date: { gte: today } },
        _count: { _all: true },
      }),
      prisma.event.groupBy({
        by: ['hostId'],
        where: { hostId: { in: hostIds }, cityId, status: { in: ['published', 'archived'] }, date: { lt: today } },
        _count: { _all: true },
      }),
    ])
    const up = new Map(upcoming.map(r => [r.hostId, r._count._all]))
    const pa = new Map(past.map(r => [r.hostId, r._count._all]))

    return [...hosts.values()]
      .map(h => ({ ...h, upcomingCount: up.get(h.id) ?? 0, hostedCount: pa.get(h.id) ?? 0 }))
      .sort(rankHosts)
  },
  ['city-host-roster'],
  { revalidate: 300, tags: [HOST_ROSTER_TAG] },
)

/**
 * The roster as THIS viewer may see it, per request, outside the cache. A
 * guest gets the guest projection (lib/hostTitles). A member loses the hosts
 * they have blocked or been blocked by — the profile route 404s the pair,
 * so the card was a dead link with a face on it — and sees a connections-only
 * host outside their connections the way a guest would (first name, no
 * photo, no link), which is what that host's own profile shows them.
 */
export async function rosterForViewer<T extends RosterHost>(roster: T[], session: SessionUser | null | undefined): Promise<T[]> {
  if (!session) return projectRosterForViewer(roster, false)
  const [blocked, restricted] = await Promise.all([
    blockedIdsFor(session.id),
    restrictedSetFor(session, roster.map(h => ({ id: h.id, profileVisibility: h.profileVisibility ?? null }))),
  ])
  return roster.filter(h => !blocked.has(h.id)).map(h => (restricted.has(h.id) ? projectHostForGuest(h) : h))
}

/**
 * Drop every city's cached roster. For the writes that change who is a host
 * or whether they may be listed: a grant or a demotion, a ban, a suspension,
 * hiding a member, deactivating a club, a host stepping down or moving
 * city. Safe outside a request (a script, a test): the cache just ages out.
 */
export function bustHostRoster(): void {
  try { revalidateTag(HOST_ROSTER_TAG) } catch { /* no request scope — the 5-minute TTL covers it */ }
}

/**
 * The cities a member leads, by name — for the profile chip. Live grants
 * only (approved and not revoked), the same pair every read of the table
 * filters on.
 */
export async function leadCityNamesFor(userId: string): Promise<string[]> {
  const rows = await prisma.cityHost.findMany({
    where:   { userId, status: 'approved', revokedAt: null },
    select:  { city: { select: { name: true } } },
    orderBy: { grantedAt: 'asc' },
  })
  return rows.map(r => r.city.name)
}
