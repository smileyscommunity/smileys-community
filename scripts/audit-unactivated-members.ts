// Approved members who never activated — the 2026-09 production audit found
// 268. Public and member-facing member totals no longer count them
// (lib/memberCount), but Club.memberCount is enrolment and still does, which
// is a product decision this report exists to inform.
//
// READ-ONLY. Nothing is written and nobody is emailed. Prints:
//   · totals by city and by approval age (<7d, 7–30d, 30–90d, >90d) — age is
//     User.joinedAt, which approval sets when it creates the account
//   · how many hold club memberships Club.memberCount counts, and per club how
//     much of memberCount is never-activated people
//   · whether each member's activation link still works: valid (an unused,
//     unexpired token), expired (only unused expired ones), none
//
// Re-inviting is a separate, existing flow — scripts/reinvite-unactivated.ts
// (DRY_RUN by default). This script never runs it.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/audit-unactivated-members.ts

import { prisma } from '@/lib/prisma'
import { NOT_ACTIVATED_MEMBER_WHERE } from '@/lib/memberCount'
import { COUNTED_CLUB_MEMBERSHIP_WHERE } from '@/lib/clubMemberCount'

const DAY = 24 * 60 * 60 * 1000

export const AGE_BUCKETS = ['<7d', '7-30d', '30-90d', '>90d'] as const
export type AgeBucket = typeof AGE_BUCKETS[number]

export const TOKEN_STATES = ['valid', 'expired', 'none'] as const
export type TokenState = typeof TOKEN_STATES[number]

export interface UnactivatedFacts {
  userId:          string
  city:            string                               // city slug
  joinedAt:        Date                                 // approval time
  clubMemberships: number                               // rows Club.memberCount counts
  tokens:          { expiresAt: Date; used: boolean }[] // activation / reset tokens
}

export function ageBucket(joinedAt: Date, now: Date): AgeBucket {
  const days = (now.getTime() - joinedAt.getTime()) / DAY
  if (days < 7)  return '<7d'
  if (days < 30) return '7-30d'
  if (days < 90) return '30-90d'
  return '>90d'
}

// A used token never activates anyone again, so it counts as no link.
export function tokenState(tokens: UnactivatedFacts['tokens'], now: Date): TokenState {
  const unused = tokens.filter(t => !t.used)
  if (unused.some(t => t.expiresAt > now)) return 'valid'
  return unused.length > 0 ? 'expired' : 'none'
}

export interface Tally {
  total:           number
  byAge:           Record<AgeBucket, number>
  byToken:         Record<TokenState, number>
  withClubs:       number
  clubMemberships: number
}

const emptyTally = (): Tally => ({
  total:           0,
  byAge:           Object.fromEntries(AGE_BUCKETS.map(b => [b, 0])) as Record<AgeBucket, number>,
  byToken:         Object.fromEntries(TOKEN_STATES.map(s => [s, 0])) as Record<TokenState, number>,
  withClubs:       0,
  clubMemberships: 0,
})

export function planUnactivated(rows: UnactivatedFacts[], now: Date) {
  const overall = emptyTally()
  const byCity  = new Map<string, Tally>()
  for (const f of rows) {
    const age   = ageBucket(f.joinedAt, now)
    const token = tokenState(f.tokens, now)
    if (!byCity.has(f.city)) byCity.set(f.city, emptyTally())
    for (const t of [overall, byCity.get(f.city)!]) {
      t.total++
      t.byAge[age]++
      t.byToken[token]++
      if (f.clubMemberships > 0) t.withClubs++
      t.clubMemberships += f.clubMemberships
    }
  }
  const cities = [...byCity]
    .map(([city, t]) => ({ city, ...t }))
    .sort((a, b) => b.total - a.total || a.city.localeCompare(b.city))
  return { overall, cities }
}

export interface ClubGapFacts {
  clubId:      string
  name:        string
  city:        string   // slug, or 'global'
  memberCount: number   // the stored counter
  unactivated: number   // counted memberships held by never-activated members
}

// activatedEnrolment is memberCount minus the never-activated rows — as good
// as the stored counter, which the nightly recount keeps honest.
export function planClubGap(clubs: ClubGapFacts[]) {
  const rows = clubs
    .filter(c => c.unactivated > 0)
    .map(c => ({
      ...c,
      activatedEnrolment: Math.max(0, c.memberCount - c.unactivated),
      share:              c.memberCount > 0 ? c.unactivated / c.memberCount : 0,
    }))
    .sort((a, b) => b.unactivated - a.unactivated || a.name.localeCompare(b.name))
  return {
    rows,
    totals: {
      clubs:                   rows.length,
      unactivatedEnrolments:   rows.reduce((n, r) => n + r.unactivated, 0),
      memberCountOfThoseClubs: rows.reduce((n, r) => n + r.memberCount, 0),
    },
  }
}

async function load() {
  const users = await prisma.user.findMany({
    where:  NOT_ACTIVATED_MEMBER_WHERE,
    select: {
      id: true, joinedAt: true,
      city:   { select: { slug: true } },
      _count: { select: { clubMemberships: { where: COUNTED_CLUB_MEMBERSHIP_WHERE } } },
    },
  })
  const ids = users.map(u => u.id)
  const tokens = ids.length === 0 ? [] : await prisma.passwordResetToken.findMany({
    where:  { userId: { in: ids } },
    select: { userId: true, expiresAt: true, used: true },
  })
  const tokensBy = new Map<string, UnactivatedFacts['tokens']>()
  for (const t of tokens) tokensBy.set(t.userId, [...(tokensBy.get(t.userId) ?? []), { expiresAt: t.expiresAt, used: t.used }])

  const facts: UnactivatedFacts[] = users.map(u => ({
    userId:          u.id,
    city:            u.city.slug,
    joinedAt:        u.joinedAt,
    clubMemberships: u._count.clubMemberships,
    tokens:          tokensBy.get(u.id) ?? [],
  }))

  // An approved never-activated user is not banned, so the counted rule's
  // user filter narrows to NOT_ACTIVATED_MEMBER_WHERE without widening.
  const gapGroups = await prisma.clubMembership.groupBy({
    by:     ['clubId'],
    where:  { ...COUNTED_CLUB_MEMBERSHIP_WHERE, user: NOT_ACTIVATED_MEMBER_WHERE },
    _count: { _all: true },
  })
  const clubs = gapGroups.length === 0 ? [] : await prisma.club.findMany({
    where:  { id: { in: gapGroups.map(g => g.clubId) } },
    select: { id: true, name: true, memberCount: true, city: { select: { slug: true } } },
  })
  const gap: ClubGapFacts[] = clubs.map(c => ({
    clubId:      c.id,
    name:        c.name,
    city:        c.city?.slug ?? 'global',
    memberCount: c.memberCount,
    unactivated: gapGroups.find(g => g.clubId === c.id)?._count._all ?? 0,
  }))
  return { facts, gap }
}

const fmtTally = (t: Tally) =>
  `total=${t.total} ` +
  AGE_BUCKETS.map(b => `${b}=${t.byAge[b]}`).join(' ') +
  ` withClubs=${t.withClubs} memberships=${t.clubMemberships} ` +
  `link valid=${t.byToken.valid} expired=${t.byToken.expired} none=${t.byToken.none}`

async function main() {
  console.log('READ-ONLY — approved members who never activated. Nothing is written, nobody is emailed.\n')
  const now = new Date()
  const { facts, gap } = await load()
  const { overall, cities } = planUnactivated(facts, now)

  console.log(`overall: ${fmtTally(overall)}\n`)
  console.log('by city:')
  for (const c of cities) console.log(`  ${c.city}: ${fmtTally(c)}`)

  // Every row, never truncated.
  const { rows, totals } = planClubGap(gap)
  console.log('\nclub gap — Club.memberCount is enrolment and still counts these:')
  for (const r of rows) {
    console.log(`  [${r.city}] ${r.clubId} "${r.name}" memberCount=${r.memberCount} neverActivated=${r.unactivated} (${Math.round(r.share * 100)}%) activated≈${r.activatedEnrolment}`)
  }
  console.log(`\nclub gap summary: clubs=${totals.clubs} neverActivatedEnrolments=${totals.unactivatedEnrolments} of memberCount=${totals.memberCountOfThoseClubs}`)
  console.log('\nTo re-invite, use the existing flow: scripts/reinvite-unactivated.ts (DRY_RUN by default). Not run here.')
}

// Only run as a CLI — tests import the planning functions.
if (/audit-unactivated-members\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
