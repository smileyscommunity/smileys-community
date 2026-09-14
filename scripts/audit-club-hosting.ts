// Read-only audit: which clubs have nobody who can answer their join requests.
// A pending request is visible from the club side only to an approved host,
// so a club without one strands its requests (2026-09 audit: 99 active clubs
// with no approved host, 42 stale pending requests). Staff now see them at
// /admin/club-requests; this reports the backlog. No writes, no APPLY mode.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/audit-club-hosting.ts
//
// Prints club names and ids, request ages and counts — never who requested.

import { prisma } from '@/lib/prisma'
import { COUNTED_CLUB_MEMBERSHIP_WHERE } from '@/lib/clubMemberCount'

export interface ClubFacts {
  id: string; name: string; slug: string
  cityName: string | null            // null = global club
  isActive: boolean; isPrivate: boolean; memberCount: number
}
export interface PendingFacts { clubId: string; requestedAt: Date }

export const AGE_BUCKETS = ['<7d', '7-30d', '30-90d', '>90d'] as const
export type AgeBucket = typeof AGE_BUCKETS[number]

export function ageBucket(days: number): AgeBucket {
  if (days < 7) return '<7d'
  if (days < 30) return '7-30d'
  if (days < 90) return '30-90d'
  return '>90d'
}

/** Pure: hostless active clubs grouped by city, and every pending request with its age and whether its club has a host. */
export function planClubHosting(input: { clubs: ClubFacts[]; hostedClubIds: Set<string>; pending: PendingFacts[]; now: Date }) {
  const clubById = new Map(input.clubs.map(c => [c.id, c]))
  const cityOf = (c: ClubFacts | undefined) => c?.cityName ?? 'Global'

  const hostless = input.clubs.filter(c => c.isActive && !input.hostedClubIds.has(c.id))
  const cities = [...new Set(hostless.map(cityOf))].sort()
  const hostlessByCity = cities.map(city => ({
    city,
    clubs: hostless.filter(c => cityOf(c) === city).sort((a, b) => a.name.localeCompare(b.name)),
  }))

  const pendingRows = input.pending
    .map(p => {
      const club = clubById.get(p.clubId)
      const ageDays = Math.floor((input.now.getTime() - p.requestedAt.getTime()) / 86_400_000)
      return {
        clubId: p.clubId, clubName: club?.name ?? '(missing club)', city: cityOf(club),
        clubActive: club?.isActive ?? false, hasHost: input.hostedClubIds.has(p.clubId),
        ageDays, bucket: ageBucket(ageDays),
      }
    })
    .sort((a, b) => b.ageDays - a.ageDays)

  const byBucket = Object.fromEntries(AGE_BUCKETS.map(b => [b, { hosted: 0, hostless: 0 }])) as Record<AgeBucket, { hosted: number; hostless: number }>
  for (const r of pendingRows) byBucket[r.bucket][r.hasHost ? 'hosted' : 'hostless']++

  return {
    hostlessByCity,
    pendingRows,
    counts: {
      activeClubs:     input.clubs.filter(c => c.isActive).length,
      activeHostless:  hostless.length,
      pending:         pendingRows.length,
      pendingHostless: pendingRows.filter(r => !r.hasHost).length,
      byBucket,
    },
  }
}

async function main() {
  console.log('READ-ONLY — nothing is written.\n')
  const [clubs, hosts, pending] = await Promise.all([
    prisma.club.findMany({
      select: { id: true, name: true, slug: true, isActive: true, isPrivate: true, memberCount: true, city: { select: { name: true } } },
    }),
    prisma.clubMembership.findMany({
      where: { ...COUNTED_CLUB_MEMBERSHIP_WHERE, role: 'host' }, select: { clubId: true }, distinct: ['clubId'],
    }),
    prisma.clubMembership.findMany({ where: { status: 'pending' }, select: { clubId: true, joinedAt: true } }),
  ])
  const plan = planClubHosting({
    clubs:         clubs.map(c => ({ id: c.id, name: c.name, slug: c.slug, cityName: c.city?.name ?? null, isActive: c.isActive, isPrivate: c.isPrivate, memberCount: c.memberCount })),
    hostedClubIds: new Set(hosts.map(h => h.clubId)),
    pending:       pending.map(p => ({ clubId: p.clubId, requestedAt: p.joinedAt })),
    now:           new Date(),
  })

  // Every row, never truncated.
  console.log('Active clubs with no approved host, by city:')
  for (const g of plan.hostlessByCity) {
    console.log(`\n  ${g.city} (${g.clubs.length})`)
    for (const c of g.clubs) console.log(`    ${c.id} /${c.slug} "${c.name}" members=${c.memberCount}${c.isPrivate ? ' private' : ''}`)
  }

  console.log('\nPending join requests, oldest first:')
  for (const r of plan.pendingRows) {
    console.log(`  ${String(r.ageDays).padStart(4)}d [${r.bucket}] ${r.city} "${r.clubName}" (${r.clubId}) host=${r.hasHost ? 'yes' : 'NO'}${r.clubActive ? '' : ' club-inactive'}`)
  }

  const c = plan.counts
  console.log(`\nsummary: activeClubs=${c.activeClubs} activeHostless=${c.activeHostless} pending=${c.pending} pendingToHostless=${c.pendingHostless}`)
  console.log(`pending by age: ${AGE_BUCKETS.map(b => `${b} hosted=${c.byBucket[b].hosted} hostless=${c.byBucket[b].hostless}`).join(' | ')}`)
}

// Only run as a CLI — tests import planClubHosting.
if (/audit-club-hosting\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
