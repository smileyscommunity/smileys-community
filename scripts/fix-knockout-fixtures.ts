// One-off: pull the FIFA knockout schedule from football-data.org
// and overlay teams + kickoffs onto our R32 → Final CupFixture rows.
// Seed-cup.ts wrote synthetic kickoffs and null teams; once FIFA
// publishes the bracket FD knows the real matches, but the cron
// sweeper's Pass 2 only matches within ±1h of the seeded kickoff
// — fine when seeded times stay close (group stage), wrong here
// because FIFA's knockout times drift hours / days from our seed.
//
//   npx tsx --env-file=.env scripts/fix-knockout-fixtures.ts
//
// Assignment is by chronological order within stage: FD's earliest
// R32 match → 2026-WC-R32-1, next → R32-2, etc. This preserves
// existing CupPrediction rows because we UPDATE in place (no
// delete/recreate) and our R32-N IDs stay stable. The bracket-flow
// labels on later rounds ("Winner R32-1 vs Winner R32-2") may stop
// matching FIFA's actual pairings — they're advisory text, not
// load-bearing routing.
//
// Idempotent — re-runs against already-overlaid rows produce no-op
// updates.

import { prisma } from '@/lib/prisma'
import { fetchCupMatches, fdStageToCupRound, fdTlaToCupCode } from '@/lib/cup-external-results'
import type { CupRound } from '@/lib/cup-external-results'

const ROUND_ID_PREFIX: Record<Exclude<CupRound, 'group'>, string> = {
  r32:   '2026-WC-R32-',
  r16:   '2026-WC-R16-',
  qf:    '2026-WC-QF-',
  sf:    '2026-WC-SF-',
  // The final is seeded as the singular id '2026-WC-FINAL' (no numeric
  // suffix) — see seed-cup.ts. Every other round is '<prefix><n>'.
  final: '2026-WC-FINAL',
}

async function main() {
  // Wide window covers every knockout match FIFA could possibly
  // schedule — group stage starts mid-June, final lands mid-July.
  const fdMatches = await fetchCupMatches('2026-06-25', '2026-07-31')

  const byRound = new Map<Exclude<CupRound, 'group'>, typeof fdMatches>()
  for (const m of fdMatches) {
    const round = fdStageToCupRound(m.stage)
    if (!round || round === 'group') continue
    const list = byRound.get(round) ?? []
    list.push(m)
    byRound.set(round, list)
  }
  for (const list of byRound.values()) {
    list.sort((a, b) => a.utcDate.localeCompare(b.utcDate))
  }

  let updated = 0
  let skipped = 0
  let warnings = 0

  for (const [round, list] of byRound) {
    const prefix = ROUND_ID_PREFIX[round]
    for (let i = 0; i < list.length; i++) {
      const m  = list[i]
      // Final has a single match seeded under the un-suffixed id; numbered
      // rounds append the 1-based match index.
      const id = round === 'final' ? prefix : `${prefix}${i + 1}`
      const home = fdTlaToCupCode(m.homeTeam.tla)
      const away = fdTlaToCupCode(m.awayTeam.tla)
      if (!home || !away) {
        console.warn(`⚠ ${id}: unmapped TLA home=${m.homeTeam.tla} away=${m.awayTeam.tla} — skipping`)
        warnings++
        continue
      }
      const kickoffAt = new Date(m.utcDate)
      try {
        const existing = await prisma.cupFixture.findUnique({ where: { id } })
        if (!existing) {
          console.warn(`⚠ Fixture ${id} not found — was seed-cup.ts run? Skipping.`)
          warnings++
          continue
        }
        const sameTeams = existing.homeTeam === home && existing.awayTeam === away
        const sameTime  = existing.kickoffAt.toISOString() === kickoffAt.toISOString()
        if (sameTeams && sameTime) {
          skipped++
          continue
        }
        await prisma.cupFixture.update({
          where: { id },
          data: {
            homeTeam:  home,
            awayTeam:  away,
            kickoffAt,
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

  console.log(`✓ Knockout fixtures: ${updated} updated, ${skipped} already correct, ${warnings} warning${warnings === 1 ? '' : 's'}`)
  console.log('Done.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
