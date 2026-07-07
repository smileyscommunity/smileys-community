// One-off backfill for knockout fixtures the 5-min sweeper missed.
//
// Why it missed: knockout rows were seeded with placeholder kickoff
// times and the deploy-time FIFA-schedule overlay only corrects GROUP
// fixtures. The sweeper matches by teams + kickoff ±2h, so every R16
// match (3-7h drift) fell through, and its ±1-day window has already
// slid past July 4-5.
//
// What this does, for every FD knockout match July 4-20:
//   1. Fixes kickoffAt where it drifts from football-data's utcDate
//      (also unblocks the sweeper for QF/SF/F going forward).
//   2. Normalizes home/away order to football-data's when a fixture
//      was seeded swapped — otherwise the sweeper's team-coded lookup
//      misses it and applied scores would land reversed.
//   3. Applies FINISHED results to unscored fixtures via the same
//      path as the sweeper: scores + winner, then scoreFixture() so
//      prediction points land; rescoreAllBrackets() after qf/final.
//
// Matching: by round + team pair first (either order); FD matches
// with unresolved/unseeded teams are paired per round against the
// remaining TBD fixtures in kickoff order, each fixture claimable
// exactly once (a ±12h window findFirst double-claimed QF-3 in an
// earlier version of this script).
//
// Idempotent: never overwrites a committed score (homeScore != null),
// only touches kickoffAt/team order when they actually differ.
//
// Run on the server:
//   DRY_RUN:  npx tsx --env-file=.env --env-file=.env.local scripts/backfill-knockout-results.ts
//   APPLY:    APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/backfill-knockout-results.ts

import { prisma } from '../lib/prisma'
import { scoreFixture, rescoreAllBrackets } from '../lib/cup'
import { fetchCupMatches, fdTlaToCupCode, fdWinnerCode, fdStageToCupRound, type FdMatch } from '../lib/cup-external-results'

const APPLY = process.env.APPLY === '1'

type Pairing = { m: FdMatch; fixtureId: string; home: string | null; away: string | null }

async function main() {
  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY RUN (set APPLY=1 to write) ===')
  const fdMatches = (await fetchCupMatches('2026-07-04', '2026-07-20'))
    .map(m => ({ m, round: fdStageToCupRound(m.stage) }))
    .filter((x): x is { m: FdMatch; round: Exclude<ReturnType<typeof fdStageToCupRound>, null> } =>
      x.round !== null && x.round !== 'group')

  const fixtures = await prisma.cupFixture.findMany({
    where:   { round: { in: [...new Set(fdMatches.map(x => x.round))] } },
    orderBy: { kickoffAt: 'asc' },
  })
  const claimed = new Set<string>()
  const pairings: Pairing[] = []
  const unpaired: typeof fdMatches = []

  // Pass A — by round + team pair, either order.
  for (const x of fdMatches) {
    const home = fdTlaToCupCode(x.m.homeTeam.tla)
    const away = fdTlaToCupCode(x.m.awayTeam.tla)
    const f = home && away
      ? fixtures.find(f => !claimed.has(f.id) && f.round === x.round &&
          ((f.homeTeam === home && f.awayTeam === away) || (f.homeTeam === away && f.awayTeam === home)))
      : undefined
    if (f) { claimed.add(f.id); pairings.push({ m: x.m, fixtureId: f.id, home, away }) }
    else unpaired.push(x)
  }

  // Pass B — leftovers (TBD teams either side) paired per round in
  // kickoff order against unclaimed fixtures with unseeded teams.
  for (const round of new Set(unpaired.map(x => x.round))) {
    const fd  = unpaired.filter(x => x.round === round)
      .sort((a, b) => new Date(a.m.utcDate).getTime() - new Date(b.m.utcDate).getTime())
    const dbf = fixtures.filter(f => !claimed.has(f.id) && f.round === round && !f.homeTeam && !f.awayTeam)
    if (fd.length !== dbf.length) {
      console.log(`WARN  ${round}: ${fd.length} unmatched FD matches vs ${dbf.length} TBD fixtures — pairing by order anyway`)
    }
    fd.forEach((x, i) => {
      const f = dbf[i]
      if (!f) { console.log(`SKIP  no fixture: ${round} ${x.m.homeTeam.tla ?? 'TBD'} - ${x.m.awayTeam.tla ?? 'TBD'} @ ${x.m.utcDate}`); return }
      claimed.add(f.id)
      pairings.push({ m: x.m, fixtureId: f.id, home: fdTlaToCupCode(x.m.homeTeam.tla), away: fdTlaToCupCode(x.m.awayTeam.tla) })
    })
  }

  let kickoffFixed = 0, orderFixed = 0, applied = 0
  let needsBracketRescore = false

  for (const { m, fixtureId, home, away } of pairings) {
    const fixture = fixtures.find(f => f.id === fixtureId)!
    const round   = fixture.round
    const utc     = new Date(m.utcDate)
    const label   = `${round} ${fixture.homeTeam ?? 'TBD'}-${fixture.awayTeam ?? 'TBD'} (${fixture.id})`

    // 1. kickoff drift
    if (fixture.kickoffAt.getTime() !== utc.getTime()) {
      const driftH = ((utc.getTime() - fixture.kickoffAt.getTime()) / 3_600_000).toFixed(1)
      console.log(`TIME  ${label}: ${fixture.kickoffAt.toISOString()} -> ${m.utcDate} (${driftH}h)`)
      if (APPLY) await prisma.cupFixture.update({ where: { id: fixture.id }, data: { kickoffAt: utc } })
      kickoffFixed++
    }

    // 2. home/away seeded in the opposite order to football-data —
    // normalize so the sweeper's Pass 1 matches and scores align.
    if (home && away && fixture.homeTeam === away && fixture.awayTeam === home) {
      console.log(`ORDER ${label}: swap to ${home}-${away} (match FD)`)
      if (APPLY) {
        await prisma.cupFixture.update({
          where: { id: fixture.id },
          data:  {
            homeTeam: home, awayTeam: away,
            homeLabel: fixture.awayLabel, awayLabel: fixture.homeLabel,
          },
        })
      }
      orderFixed++
    }

    // 3. finished result on an unscored fixture
    const hs = m.score.fullTime.home
    const as = m.score.fullTime.away
    if ((m.status === 'FINISHED' || m.status === 'AWARDED') && hs !== null && as !== null) {
      if (fixture.homeScore !== null) continue // committed truth is final
      const winner = fdWinnerCode(m)
      console.log(`SCORE ${label}: ${home} ${hs}-${as} ${away} winner=${winner}`)
      if (APPLY) {
        const data: Record<string, unknown> = {
          homeScore: hs, awayScore: as, winnerTeam: winner ?? null,
          suggestedHomeScore: hs, suggestedAwayScore: as,
          suggestedWinnerTeam: winner ?? null,
          suggestedStatus: m.status, suggestedAt: new Date(),
        }
        if (!fixture.homeTeam || !fixture.awayTeam) {
          data.homeTeam = home; data.awayTeam = away
          data.suggestedHomeTeam = home; data.suggestedAwayTeam = away
        }
        await prisma.cupFixture.update({ where: { id: fixture.id }, data })
        await scoreFixture(fixture.id)
        if (round === 'qf' || round === 'final') needsBracketRescore = true
      }
      applied++
    }
  }

  if (APPLY && needsBracketRescore) {
    console.log('Rescoring brackets…')
    await rescoreAllBrackets()
  }

  console.log(`\nkickoff fixes: ${kickoffFixed} · order fixes: ${orderFixed} · results ${APPLY ? 'applied' : 'to apply'}: ${applied}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
