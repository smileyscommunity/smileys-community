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
// exists to prevent.
export function approx(n: number): string {
  if (n < 100) return String(n)
  const step = n < 1000 ? 50 : 100
  return `${(Math.floor(n / step) * step).toLocaleString('en-US')}+`
}

/** The stat row shape the footer and marketing pages render. */
export async function getDefaultStatRow(): Promise<{ value: string; label: string }[]> {
  const s = await getCommunityStats()
  return [
    { value: approx(s.members), label: 'Members' },
    { value: approx(s.events),  label: 'Events hosted' },
    { value: approx(s.clubs),   label: 'Active clubs' },
  ]
}
