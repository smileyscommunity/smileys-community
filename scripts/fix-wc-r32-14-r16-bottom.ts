/**
 * One-off (2026-07-04): finish the R32 bottom half + fill R16-7/8 from the
 * REAL WC2026 bracket (verified vs FIFA/ESPN/Sky/Olympics).
 *
 *  - R32-14 AUS–EGY: DB had 3-5 / no winner → real 1-1, Egypt won 4-2 on pens.
 *  - R32-16 COL–GHA: DB had 2-0 → real 1-0 (winner COL unchanged).
 *  - R16-7 = Switzerland vs Colombia   (SUI already set; add away = COL)
 *  - R16-8 = Egypt vs Argentina
 * (R32-15 ARG 3-2 CPV AET is already correct.)
 *
 * Run: npx tsx --env-file=.env --env-file=.env.local scripts/fix-wc-r32-14-r16-bottom.ts
 * DRY_RUN=1 to preview.
 */
import { prisma } from '@/lib/prisma'
import { scoreFixture, isValidTeamCode } from '@/lib/cup'

const DRY = process.env.DRY_RUN === '1'

async function main() {
  // --- R32-14: set 1-1, winner EGY (shootout), re-score predictions ---
  {
    const id = '2026-WC-R32-14'
    const fx = await prisma.cupFixture.findUnique({ where: { id }, select: { homeScore: true, awayScore: true, winnerTeam: true } })
    const was = `${fx?.homeScore}-${fx?.awayScore}/${fx?.winnerTeam ?? 'none'}`
    if (DRY) console.log(`R32-14: would set 1-1 winner=EGY (was ${was})`)
    else {
      await prisma.cupFixture.update({ where: { id }, data: { homeScore: 1, awayScore: 1, winnerTeam: 'EGY' } })
      const r = await scoreFixture(id)
      console.log(`R32-14: AUS 1-1 EGY winner=EGY (was ${was}) — ${r.scored} predictions re-scored`)
    }
  }

  // --- R32-16: correct score to 1-0 (winner COL unchanged, no re-score needed) ---
  {
    const id = '2026-WC-R32-16'
    const fx = await prisma.cupFixture.findUnique({ where: { id }, select: { homeScore: true, awayScore: true } })
    if (DRY) console.log(`R32-16: would set 1-0 (was ${fx?.homeScore}-${fx?.awayScore})`)
    else {
      await prisma.cupFixture.update({ where: { id }, data: { homeScore: 1, awayScore: 0 } })
      console.log(`R32-16: COL 1-0 GHA (was ${fx?.homeScore}-${fx?.awayScore})`)
    }
  }

  // --- R16 bottom half: real matchups (NOT the sequential seed labels) ---
  const r16 = [
    { id: '2026-WC-R16-7', home: 'SUI', away: 'COL' }, // Switzerland vs Colombia
    { id: '2026-WC-R16-8', home: 'EGY', away: 'ARG' }, // Egypt vs Argentina
  ]
  for (const m of r16) {
    for (const c of [m.home, m.away]) if (!isValidTeamCode(c)) throw new Error(`bad code ${c}`)
    const fx = await prisma.cupFixture.findUnique({ where: { id: m.id }, select: { homeTeam: true, awayTeam: true } })
    const was = `${fx?.homeTeam ?? '·'} vs ${fx?.awayTeam ?? '·'}`
    if (DRY) console.log(`${m.id}: would set ${m.home} vs ${m.away} (was ${was})`)
    else {
      await prisma.cupFixture.update({ where: { id: m.id }, data: { homeTeam: m.home, awayTeam: m.away } })
      console.log(`${m.id}: ${m.home} vs ${m.away} (was ${was})`)
    }
  }

  await prisma.$disconnect()
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
