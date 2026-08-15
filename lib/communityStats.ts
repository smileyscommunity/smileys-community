// Platform-wide community numbers, straight from the database.
//
// Why this exists: the headline stats on the footer, About, Why, Advertise and
// Get-involved pages come from data/content.json (admin-editable at
// /admin/content), and each page ALSO carried its own hard-coded fallback.
// Those fallbacks had drifted apart from each other and from reality — the
// footer claimed "120+ active clubs", About "70+", Why "20+", while the
// database had 159. A number nobody recomputes is a number that quietly stops
// being true.
//
// So the fallback is now measured rather than typed. The admin override still
// wins: a deliberate editorial figure (e.g. a community size that counts people
// we reach outside the platform) is a legitimate choice, and /admin/content
// shows the live number beside each field so that choice is made with the real
// one in view rather than by accident.

import { prisma } from './prisma'

export interface CommunityStats {
  members: number   // approved accounts
  events:  number   // events actually run (published or archived)
  clubs:   number   // active clubs
}

const TTL_MS = 5 * 60_000
let cache: { value: CommunityStats; expires: number } | null = null

export async function getCommunityStats(): Promise<CommunityStats> {
  if (cache && cache.expires > Date.now()) return cache.value

  const [members, events, clubs] = await Promise.all([
    prisma.user.count({ where: { status: 'approved' } }),
    prisma.event.count({ where: { status: { in: ['published', 'archived'] } } }),
    prisma.club.count({ where: { isActive: true } }),
  ])

  const value = { members, events, clubs }
  cache = { value, expires: Date.now() + TTL_MS }
  return value
}

// Rounded down to a "+" figure the way marketing copy reads: 1,442 → "1,400+".
// Never rounds up — an inflated number is exactly the failure mode this module
// exists to prevent. The step tightens for small numbers so rounding doesn't
// cost more than it tidies: at a flat step of 50, 147 clubs would advertise as
// "100+", which is a worse claim than the true one.
export function approx(n: number): string {
  if (n < 100) return String(n)
  const step = n < 200 ? 10 : n < 1000 ? 50 : 100
  return `${(Math.floor(n / step) * step).toLocaleString('en-US')}+`
}

/** The stat row shape the footer and marketing pages render. */
export interface StatRow {
  value?: string
  label: string
  // When set, `value` is ignored and the number is measured instead. This is
  // how a stat stops going stale: "Active clubs" tracks the database, while
  // "in our WhatsApp groups" stays editorial because nothing in the database
  // knows about WhatsApp.
  metric?: keyof CommunityStats
}

export async function getDefaultStatRow(): Promise<{ value: string; label: string }[]> {
  const s = await getCommunityStats()
  return [
    { value: approx(s.members), label: 'Members' },
    { value: approx(s.events),  label: 'Events hosted' },
    { value: approx(s.clubs),   label: 'Active clubs' },
  ]
}

/**
 * The stats every public surface renders: the admin's editorial rows, with any
 * `metric`-backed row replaced by a measured, rounded-down figure.
 *
 * Resolved centrally rather than per page — the footer, About, Why, Advertise
 * and Get-involved all showed their own hard-coded numbers once, which is how
 * the club count ended up published as three different values.
 */
export async function resolveStats(rows: StatRow[] | undefined): Promise<{ value: string; label: string }[]> {
  if (!rows?.length) return getDefaultStatRow()
  if (!rows.some(r => r.metric)) {
    return rows.map(r => ({ value: r.value ?? '', label: r.label }))
  }
  const s = await getCommunityStats()
  return rows.map(r => ({
    value: r.metric ? approx(s[r.metric]) : (r.value ?? ''),
    label: r.label,
  }))
}
