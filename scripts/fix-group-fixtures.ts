// One-off: rewrite the 72 group-stage CupFixture rows with the
// real FIFA schedule (verified Dec 6, 2025 unveil). The original
// seed-cup.ts produced placeholder pairings (uniform T1×T2 + T3×T4
// MD rotation) and synthetic times — fine to bootstrap the table
// but wrong for the actual tournament. This script fixes both.
//
//   npx tsx --env-file=.env scripts/fix-group-fixtures.ts
//
// Idempotent — re-runs against an already-corrected DB produce
// no-op updates. Existing CupPrediction rows are preserved
// because we UPDATE the fixtures in place rather than delete +
// recreate (CupPrediction has onDelete: Cascade against
// CupFixture).
//
// Source: Sky Sports schedule page (UK BST times). Converted to
// Europe/Istanbul (UTC+3, no DST) via Intl.DateTimeFormat so the
// date boundary is exact even when a 23:00 BST kickoff rolls past
// midnight Istanbul.

import { prisma } from '@/lib/prisma'

interface ScheduleEntry {
  date: string   // YYYY-MM-DD (Istanbul calendar day for the BST timestamp below)
  bst:  string   // HH:MM
  group: string  // A-L
  home: string   // ISO-3 (matches lib/cup.ts CUP_TEAMS)
  away: string
  venue: string
}

// 72 matches in source-document order. Per-group ordering is
// chronological by date+time so the MD1/MD2/MD3 progression
// follows the broadcast.
const SCHEDULE: ScheduleEntry[] = [
  // Group A
  { date: '2026-06-11', bst: '20:00', group: 'A', home: 'MEX', away: 'ZAF', venue: 'Mexico City' },
  { date: '2026-06-12', bst: '03:00', group: 'A', home: 'KOR', away: 'CZE', venue: 'Zapopan' },
  { date: '2026-06-18', bst: '17:00', group: 'A', home: 'CZE', away: 'ZAF', venue: 'Atlanta' },
  { date: '2026-06-19', bst: '02:00', group: 'A', home: 'MEX', away: 'KOR', venue: 'Zapopan' },
  { date: '2026-06-25', bst: '02:00', group: 'A', home: 'ZAF', away: 'KOR', venue: 'Guadalupe' },
  { date: '2026-06-25', bst: '02:00', group: 'A', home: 'CZE', away: 'MEX', venue: 'Mexico City' },
  // Group B
  { date: '2026-06-12', bst: '20:00', group: 'B', home: 'CAN', away: 'BIH', venue: 'Toronto' },
  { date: '2026-06-13', bst: '20:00', group: 'B', home: 'QAT', away: 'SUI', venue: 'Santa Clara' },
  { date: '2026-06-18', bst: '20:00', group: 'B', home: 'SUI', away: 'BIH', venue: 'Los Angeles' },
  { date: '2026-06-18', bst: '23:00', group: 'B', home: 'CAN', away: 'QAT', venue: 'Vancouver' },
  { date: '2026-06-24', bst: '20:00', group: 'B', home: 'SUI', away: 'CAN', venue: 'Vancouver' },
  { date: '2026-06-24', bst: '20:00', group: 'B', home: 'BIH', away: 'QAT', venue: 'Seattle' },
  // Group C
  { date: '2026-06-13', bst: '23:00', group: 'C', home: 'BRA', away: 'MAR', venue: 'New Jersey' },
  { date: '2026-06-14', bst: '02:00', group: 'C', home: 'HAI', away: 'SCO', venue: 'Foxborough' },
  { date: '2026-06-19', bst: '23:00', group: 'C', home: 'SCO', away: 'MAR', venue: 'Foxborough' },
  { date: '2026-06-20', bst: '01:30', group: 'C', home: 'BRA', away: 'HAI', venue: 'Philadelphia' },
  { date: '2026-06-24', bst: '23:00', group: 'C', home: 'MAR', away: 'HAI', venue: 'Atlanta' },
  { date: '2026-06-24', bst: '23:00', group: 'C', home: 'SCO', away: 'BRA', venue: 'Miami' },
  // Group D
  { date: '2026-06-13', bst: '02:00', group: 'D', home: 'USA', away: 'PAR', venue: 'Los Angeles' },
  { date: '2026-06-14', bst: '05:00', group: 'D', home: 'AUS', away: 'TUR', venue: 'Vancouver' },
  { date: '2026-06-19', bst: '20:00', group: 'D', home: 'USA', away: 'AUS', venue: 'Seattle' },
  { date: '2026-06-20', bst: '04:00', group: 'D', home: 'TUR', away: 'PAR', venue: 'Santa Clara' },
  { date: '2026-06-26', bst: '03:00', group: 'D', home: 'TUR', away: 'USA', venue: 'Los Angeles' },
  { date: '2026-06-26', bst: '03:00', group: 'D', home: 'PAR', away: 'AUS', venue: 'Santa Clara' },
  // Group E
  { date: '2026-06-14', bst: '18:00', group: 'E', home: 'GER', away: 'CUW', venue: 'Houston' },
  { date: '2026-06-15', bst: '00:00', group: 'E', home: 'CIV', away: 'ECU', venue: 'Philadelphia' },
  { date: '2026-06-20', bst: '21:00', group: 'E', home: 'GER', away: 'CIV', venue: 'Toronto' },
  { date: '2026-06-21', bst: '01:00', group: 'E', home: 'ECU', away: 'CUW', venue: 'Kansas City' },
  { date: '2026-06-25', bst: '21:00', group: 'E', home: 'CUW', away: 'CIV', venue: 'Philadelphia' },
  { date: '2026-06-25', bst: '21:00', group: 'E', home: 'ECU', away: 'GER', venue: 'New Jersey' },
  // Group F
  { date: '2026-06-14', bst: '21:00', group: 'F', home: 'NED', away: 'JPN', venue: 'Arlington' },
  { date: '2026-06-15', bst: '03:00', group: 'F', home: 'SWE', away: 'TUN', venue: 'Guadalupe' },
  { date: '2026-06-20', bst: '18:00', group: 'F', home: 'NED', away: 'SWE', venue: 'Houston' },
  { date: '2026-06-21', bst: '05:00', group: 'F', home: 'TUN', away: 'JPN', venue: 'Guadalupe' },
  { date: '2026-06-26', bst: '00:00', group: 'F', home: 'TUN', away: 'NED', venue: 'Kansas City' },
  { date: '2026-06-26', bst: '00:00', group: 'F', home: 'JPN', away: 'SWE', venue: 'Arlington' },
  // Group G
  { date: '2026-06-15', bst: '20:00', group: 'G', home: 'BEL', away: 'EGY', venue: 'Seattle' },
  { date: '2026-06-16', bst: '02:00', group: 'G', home: 'IRN', away: 'NZL', venue: 'Los Angeles' },
  { date: '2026-06-21', bst: '20:00', group: 'G', home: 'BEL', away: 'IRN', venue: 'Los Angeles' },
  { date: '2026-06-22', bst: '02:00', group: 'G', home: 'NZL', away: 'EGY', venue: 'Vancouver' },
  { date: '2026-06-27', bst: '04:00', group: 'G', home: 'NZL', away: 'BEL', venue: 'Vancouver' },
  { date: '2026-06-27', bst: '04:00', group: 'G', home: 'EGY', away: 'IRN', venue: 'Seattle' },
  // Group H
  { date: '2026-06-15', bst: '17:00', group: 'H', home: 'ESP', away: 'CPV', venue: 'Atlanta' },
  { date: '2026-06-15', bst: '23:00', group: 'H', home: 'KSA', away: 'URU', venue: 'Miami' },
  { date: '2026-06-21', bst: '17:00', group: 'H', home: 'ESP', away: 'KSA', venue: 'Atlanta' },
  { date: '2026-06-21', bst: '23:00', group: 'H', home: 'URU', away: 'CPV', venue: 'Miami' },
  { date: '2026-06-27', bst: '01:00', group: 'H', home: 'CPV', away: 'KSA', venue: 'Houston' },
  { date: '2026-06-27', bst: '01:00', group: 'H', home: 'URU', away: 'ESP', venue: 'Zapopan' },
  // Group I
  { date: '2026-06-16', bst: '20:00', group: 'I', home: 'FRA', away: 'SEN', venue: 'New Jersey' },
  { date: '2026-06-16', bst: '23:00', group: 'I', home: 'IRQ', away: 'NOR', venue: 'Foxborough' },
  { date: '2026-06-22', bst: '22:00', group: 'I', home: 'FRA', away: 'IRQ', venue: 'Philadelphia' },
  { date: '2026-06-23', bst: '01:00', group: 'I', home: 'NOR', away: 'SEN', venue: 'Toronto' },
  { date: '2026-06-26', bst: '20:00', group: 'I', home: 'NOR', away: 'FRA', venue: 'Foxborough' },
  { date: '2026-06-26', bst: '20:00', group: 'I', home: 'SEN', away: 'IRQ', venue: 'Toronto' },
  // Group J
  { date: '2026-06-17', bst: '02:00', group: 'J', home: 'ARG', away: 'ALG', venue: 'Kansas City' },
  { date: '2026-06-17', bst: '05:00', group: 'J', home: 'AUT', away: 'JOR', venue: 'Santa Clara' },
  { date: '2026-06-22', bst: '18:00', group: 'J', home: 'ARG', away: 'AUT', venue: 'Arlington' },
  { date: '2026-06-23', bst: '04:00', group: 'J', home: 'JOR', away: 'ALG', venue: 'Santa Clara' },
  { date: '2026-06-28', bst: '03:00', group: 'J', home: 'ALG', away: 'AUT', venue: 'Kansas City' },
  { date: '2026-06-28', bst: '03:00', group: 'J', home: 'JOR', away: 'ARG', venue: 'Arlington' },
  // Group K
  { date: '2026-06-17', bst: '18:00', group: 'K', home: 'POR', away: 'COD', venue: 'Houston' },
  { date: '2026-06-18', bst: '03:00', group: 'K', home: 'UZB', away: 'COL', venue: 'Mexico City' },
  { date: '2026-06-23', bst: '18:00', group: 'K', home: 'POR', away: 'UZB', venue: 'Houston' },
  { date: '2026-06-24', bst: '03:00', group: 'K', home: 'COL', away: 'COD', venue: 'Zapopan' },
  { date: '2026-06-28', bst: '00:30', group: 'K', home: 'COL', away: 'POR', venue: 'Miami' },
  { date: '2026-06-28', bst: '00:30', group: 'K', home: 'COD', away: 'UZB', venue: 'Atlanta' },
  // Group L
  { date: '2026-06-17', bst: '21:00', group: 'L', home: 'ENG', away: 'CRO', venue: 'Arlington' },
  { date: '2026-06-18', bst: '00:00', group: 'L', home: 'GHA', away: 'PAN', venue: 'Toronto' },
  { date: '2026-06-23', bst: '21:00', group: 'L', home: 'ENG', away: 'GHA', venue: 'Foxborough' },
  { date: '2026-06-24', bst: '00:00', group: 'L', home: 'PAN', away: 'CRO', venue: 'Foxborough' },
  { date: '2026-06-27', bst: '22:00', group: 'L', home: 'PAN', away: 'ENG', venue: 'New Jersey' },
  { date: '2026-06-27', bst: '22:00', group: 'L', home: 'CRO', away: 'GHA', venue: 'Philadelphia' },
]

// Convert a BST (UTC+1) timestamp to a fully-qualified Istanbul
// (UTC+3, no DST) ISO 8601 string. Uses Intl in 'sv-SE' locale
// (yyyy-mm-dd hh:mm:ss format) so the date boundary is computed
// correctly when a late-evening BST kickoff rolls past midnight
// in Istanbul.
function bstToIstanbulIso(date: string, bst: string): string {
  const dt = new Date(`${date}T${bst}:00+01:00`)
  if (isNaN(dt.getTime())) throw new Error(`Invalid BST datetime: ${date} ${bst}`)
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone:   'Europe/Istanbul',
    year:       'numeric',  month:  '2-digit', day:    '2-digit',
    hour:       '2-digit',  minute: '2-digit', second: '2-digit',
    hour12:     false,
  })
  const parts = fmt.formatToParts(dt)
  const get = (t: string) => parts.find(p => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+03:00`
}

// The original seed allocated 6 IDs per group following the
// rotation [(0,1),(2,3)], [(0,2),(1,3)], [(0,3),(1,2)]. Those
// names ("1v2", "3v4") encoded a pairing that's wrong for the
// actual schedule. We keep the IDs as opaque primary keys and
// overwrite the team data; the suffix label becomes vestigial
// but visible only in admin logs.
const ID_SUFFIXES = [
  'MD1-1v2', 'MD1-3v4',
  'MD2-1v3', 'MD2-2v4',
  'MD3-1v4', 'MD3-2v3',
]

async function main() {
  if (SCHEDULE.length !== 72) throw new Error(`Schedule has ${SCHEDULE.length} entries, expected 72`)

  // Bucket by group, sort each group chronologically.
  const byGroup = new Map<string, ScheduleEntry[]>()
  for (const e of SCHEDULE) {
    const list = byGroup.get(e.group) ?? []
    list.push(e)
    byGroup.set(e.group, list)
  }
  for (const list of byGroup.values()) {
    list.sort((a, b) => `${a.date} ${a.bst}`.localeCompare(`${b.date} ${b.bst}`))
  }

  let updated = 0
  let skipped = 0
  let warnings = 0

  for (const [letter, list] of byGroup) {
    if (list.length !== 6) {
      console.warn(`⚠ Group ${letter} has ${list.length} matches (expected 6) — skipping`)
      warnings++
      continue
    }
    for (let i = 0; i < 6; i++) {
      const entry = list[i]
      const id = `2026-WC-G-${letter}-${ID_SUFFIXES[i]}`
      const kickoffIso = bstToIstanbulIso(entry.date, entry.bst)
      const kickoffAt  = new Date(kickoffIso)
      try {
        const existing = await prisma.cupFixture.findUnique({ where: { id } })
        if (!existing) {
          console.warn(`⚠ Fixture ${id} not found — was the seed run? Skipping.`)
          warnings++
          continue
        }
        const sameTeams = existing.homeTeam === entry.home && existing.awayTeam === entry.away
        const sameTime  = existing.kickoffAt.toISOString() === kickoffAt.toISOString()
        const sameVenue = existing.venue === entry.venue
        if (sameTeams && sameTime && sameVenue) {
          skipped++
          continue
        }
        await prisma.cupFixture.update({
          where: { id },
          data: {
            homeTeam:  entry.home,
            awayTeam:  entry.away,
            kickoffAt,
            venue:     entry.venue,
            homeLabel: null,
            awayLabel: null,
          },
        })
        updated++
      } catch (e) {
        console.warn(`⚠ Could not update ${id}:`, (e as Error).message)
        warnings++
      }
    }
  }

  console.log(`✓ Group fixtures: ${updated} updated, ${skipped} already correct, ${warnings} warning${warnings === 1 ? '' : 's'}`)
  console.log('Done.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
