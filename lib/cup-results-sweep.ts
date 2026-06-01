// Shared sweeper body that pulls football-data.org and writes
// per-fixture suggestions. Called by:
//   - app/api/cron/sweep-cup-results (system crontab, every 5 min)
//   - app/api/admin/cup/results/refresh (admin-triggered refresh
//     button on the Fixtures + results tab)
//
// Extracted from the cron route so the admin-side "Trigger now"
// button reuses the exact same logic without duplicating it or
// going through the CRON_SECRET-gated endpoint.

import { prisma } from './prisma'
import { fetchCupMatches, fdTlaToCupCode, fdWinnerCode } from './cup-external-results'

export interface SweepResult {
  matchesScanned:      number
  suggested:           number
  skippedTeamMismatch: number
  skippedNoFixture:    number
  window:              { from: string; to: string }
}

// YYYY-MM-DD in UTC. football-data.org's date filters operate on
// UTC dates; a fixture that kicks off late Istanbul time can sit
// in a different UTC date than the local one. We pull a [yesterday,
// today+1] window so a match that finished after midnight UTC
// still lands.
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function runCupResultsSweep(): Promise<SweepResult> {
  const now      = new Date()
  const dateFrom = isoDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const dateTo   = isoDate(new Date(now.getTime() + 24 * 60 * 60 * 1000))

  // One API call. ~10 req/min free-tier ceiling means we have
  // plenty of headroom at 5-min cadence.
  const fdMatches = await fetchCupMatches(dateFrom, dateTo)

  let suggested           = 0
  let skippedTeamMismatch = 0
  let skippedNoFixture    = 0

  for (const m of fdMatches) {
    const home = fdTlaToCupCode(m.homeTeam.tla)
    const away = fdTlaToCupCode(m.awayTeam.tla)
    if (!home || !away) { skippedTeamMismatch += 1; continue }

    // Find the fixture by (utcDate ±2h, homeTeam, awayTeam). A
    // ±2h tolerance covers small kickoff-time corrections we
    // overlay via scripts/fix-group-fixtures.ts without missing
    // the row.
    const utc = new Date(m.utcDate)
    const lo  = new Date(utc.getTime() - 2 * 60 * 60 * 1000)
    const hi  = new Date(utc.getTime() + 2 * 60 * 60 * 1000)

    const fixture = await prisma.cupFixture.findFirst({
      where:  {
        homeTeam:  home,
        awayTeam:  away,
        kickoffAt: { gte: lo, lte: hi },
      },
      select: { id: true, winnerTeam: true },
    })
    if (!fixture) { skippedNoFixture += 1; continue }

    // Already committed — admin's truth is final, no overwrite.
    if (fixture.winnerTeam) continue

    const suggestedWinner = fdWinnerCode(m)
    await prisma.cupFixture.update({
      where: { id: fixture.id },
      data:  {
        suggestedHomeScore:  m.score.fullTime.home ?? null,
        suggestedAwayScore:  m.score.fullTime.away ?? null,
        suggestedWinnerTeam: suggestedWinner,
        suggestedStatus:     m.status,
        suggestedAt:         new Date(),
      },
    })
    suggested += 1
  }

  return {
    matchesScanned: fdMatches.length,
    suggested,
    skippedTeamMismatch,
    skippedNoFixture,
    window: { from: dateFrom, to: dateTo },
  }
}
