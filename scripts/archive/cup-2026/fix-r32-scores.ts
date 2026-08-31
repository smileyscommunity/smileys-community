/**
 * One-off: correct the 3 wrong Round-of-32 results (verified vs official
 * FIFA/ESPN/CBS results) and re-score their predictions. Mirrors what the
 * admin PUT /api/admin/cup/fixtures/[id] endpoint does: update the fixture,
 * then scoreFixture() to award CupPrediction points for correct picks.
 *
 * Penalty-shootout matches store the regulation/ET score + the shootout
 * winner in winnerTeam (same convention as every other fixture).
 *
 * Run: npx tsx --env-file=.env --env-file=.env.local scripts/fix-r32-scores.ts
 * DRY_RUN=1 to preview without writing.
 */
import { prisma } from '@/lib/prisma'
import { scoreFixture } from '@/lib/cup'

const DRY_RUN = process.env.DRY_RUN === '1'

const CORRECTIONS = [
  // Germany 1-1 Paraguay (Paraguay won 4-3 on pens). DB had a bogus 5-6, no winner.
  { home: 'GER', away: 'PAR', homeScore: 1, awayScore: 1, winner: 'PAR' },
  // Netherlands 1-1 Morocco (Morocco won 3-2 on pens). Score was right, winner missing.
  { home: 'NED', away: 'MAR', homeScore: 1, awayScore: 1, winner: 'MAR' },
  // Portugal 2-1 Croatia (regulation, stoppage-time winner). DB had 2-2, no winner.
  { home: 'POR', away: 'CRO', homeScore: 2, awayScore: 1, winner: 'POR' },
]

async function main() {
  for (const c of CORRECTIONS) {
    const fx = await prisma.cupFixture.findFirst({
      where: { round: 'r32', homeTeam: c.home, awayTeam: c.away },
      select: { id: true, homeScore: true, awayScore: true, winnerTeam: true, points: true },
    })
    if (!fx) { console.log(`✗ SKIP ${c.home}-${c.away}: fixture not found`); continue }

    const before = `${fx.homeScore ?? '·'}-${fx.awayScore ?? '·'}/${fx.winnerTeam ?? 'none'}`
    if (DRY_RUN) {
      console.log(`would set ${c.home} ${c.homeScore}-${c.awayScore} ${c.away} winner=${c.winner} (was ${before}, fixture worth ${fx.points}pts)`)
      continue
    }

    await prisma.cupFixture.update({
      where: { id: fx.id },
      data: { homeScore: c.homeScore, awayScore: c.awayScore, winnerTeam: c.winner },
    })
    const r = await scoreFixture(fx.id)
    console.log(`✓ ${c.home} ${c.homeScore}-${c.awayScore} ${c.away} winner=${c.winner} (was ${before}) — ${r.scored} prediction(s) re-scored @ ${r.points}pts`)
  }
  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
