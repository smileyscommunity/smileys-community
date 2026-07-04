/**
 * One-off: fill Round-of-16 teams from completed R32 winners, using the REAL
 * WC2026 bracket (verified vs official sources), NOT the seed's sequential
 * "Winner R32-N" placeholder pairing (which is wrong for the top half).
 *
 * Each matchup is placed in the app R16 slot whose winner feeds the correct
 * QF: app QF-N = Winner R16-(2N-1) vs Winner R16-2N, and the real bracket
 * groups the same-day pair into one QF — so the date slots already line up.
 *
 * Team-set only (no winnerTeam) → nothing is scored. Undecided feeders
 * (R32-14 AUS/EGY, R32-15 ARG/CPV, R32-16 COL/GHA) are left blank.
 *
 * Run: npx tsx --env-file=.env --env-file=.env.local scripts/fill-r16.ts
 * DRY_RUN=1 to preview.
 */
import { prisma } from '@/lib/prisma'
import { isValidTeamCode } from '@/lib/cup'

const DRY_RUN = process.env.DRY_RUN === '1'

const R16: { id: string; home: string | null; away: string | null }[] = [
  { id: '2026-WC-R16-1', home: 'CAN', away: 'MAR' }, // QF1
  { id: '2026-WC-R16-2', home: 'PAR', away: 'FRA' }, // QF1
  { id: '2026-WC-R16-3', home: 'BRA', away: 'NOR' }, // QF2
  { id: '2026-WC-R16-4', home: 'MEX', away: 'ENG' }, // QF2
  { id: '2026-WC-R16-5', home: 'POR', away: 'ESP' }, // QF3
  { id: '2026-WC-R16-6', home: 'USA', away: 'BEL' }, // QF3
  { id: '2026-WC-R16-7', home: 'SUI', away: null  }, // QF4 — away = Winner AUS/EGY (pending)
  // 2026-WC-R16-8 = Winner(ARG/CPV) vs Winner(COL/GHA) — both pending, untouched
]

async function main() {
  for (const m of R16) {
    for (const code of [m.home, m.away]) {
      if (code && !isValidTeamCode(code)) { throw new Error(`Invalid team code: ${code}`) }
    }
    const fx = await prisma.cupFixture.findUnique({ where: { id: m.id }, select: { homeTeam: true, awayTeam: true } })
    if (!fx) { console.log(`✗ ${m.id} not found`); continue }
    const was = `${fx.homeTeam ?? '·'} vs ${fx.awayTeam ?? '·'}`
    if (DRY_RUN) { console.log(`would set ${m.id}: ${m.home} vs ${m.away ?? '(pending)'}  (was ${was})`); continue }
    await prisma.cupFixture.update({ where: { id: m.id }, data: { homeTeam: m.home, awayTeam: m.away } })
    console.log(`✓ ${m.id}: ${m.home} vs ${m.away ?? '(pending)'}  (was ${was})`)
  }
  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
