// Shared sweeper body that pulls football-data.org and writes
// per-fixture suggestions AND auto-commits FINISHED results.
// Called by:
//   - app/api/cron/sweep-cup-results (system crontab, every 5 min)
//   - app/api/admin/cup/results/refresh (admin-triggered refresh
//     button on the Fixtures + results tab)
//
// Extracted from the cron route so the admin-side "Trigger now"
// button reuses the exact same logic without duplicating it or
// going through the CRON_SECRET-gated endpoint.

import { prisma } from './prisma'
import { scoreFixture, rescoreAllBrackets } from './cup'
import { fetchCupMatches, fdTlaToCupCode, fdWinnerCode, fdStageToCupRound } from './cup-external-results'

export interface SweepResult {
  matchesScanned:      number
  suggested:           number
  autoApplied:         number   // FINISHED results committed without admin click
  // How many of the suggestions also wrote team assignments for
  // a TBD knockout slot. Separate counter so admin can tell at a
  // glance whether the sweep filled in a new R32/R16/QF/SF/F row.
  suggestedTeams:      number
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
  let autoApplied         = 0
  let suggestedTeams      = 0
  let skippedTeamMismatch = 0
  let skippedNoFixture    = 0

  for (const m of fdMatches) {
    const home = fdTlaToCupCode(m.homeTeam.tla)
    const away = fdTlaToCupCode(m.awayTeam.tla)
    if (!home || !away) {
      console.warn(`[cup-sweep] TLA mismatch: home=${m.homeTeam.tla}→${home} away=${m.awayTeam.tla}→${away} status=${m.status}`)
      skippedTeamMismatch += 1
      continue
    }

    // Find the fixture by (utcDate ±2h, homeTeam, awayTeam). A
    // ±2h tolerance covers small kickoff-time corrections we
    // overlay via scripts/fix-group-fixtures.ts without missing
    // the row.
    const utc = new Date(m.utcDate)
    const lo  = new Date(utc.getTime() - 2 * 60 * 60 * 1000)
    const hi  = new Date(utc.getTime() + 2 * 60 * 60 * 1000)

    // Pass 1 — by team codes. ±2h is wide enough to cover
    // kickoff overlay drift while still being narrow enough that
    // two different (home, away) matchups can't collide. orderBy
    // makes the result deterministic when two rows would match
    // (shouldn't happen, but defensive).
    let fixture = await prisma.cupFixture.findFirst({
      where:   {
        homeTeam:  home,
        awayTeam:  away,
        kickoffAt: { gte: lo, lte: hi },
      },
      orderBy: { kickoffAt: 'asc' },
      select:  {
        id: true, round: true, winnerTeam: true, homeTeam: true, awayTeam: true,
        homeScore: true,
        suggestedHomeScore: true, suggestedAwayScore: true, suggestedWinnerTeam: true,
        suggestedStatus: true, suggestedHomeTeam: true, suggestedAwayTeam: true,
      },
    })

    // Pass 2 — fallback for TBD knockout slots. Once football-data
    // resolves the teams upstream (after the prior round wraps),
    // our R32/R16/QF/SF/F fixtures are still seeded with null
    // home/away. The team-coded lookup above misses them.
    //
    // Window tightened to ±1h here (vs ±2h on Pass 1): without
    // team codes the only thing pinning a TBD fixture to its
    // football-data counterpart is the kickoff time. FIFA spaces
    // knockouts ≥3h apart, so ±1h won't collide. orderBy gives
    // deterministic resolution if two would somehow tie.
    let isTeamSuggestion = false
    if (!fixture) {
      const round = fdStageToCupRound(m.stage)
      if (round && round !== 'group') {
        const tightLo = new Date(utc.getTime() - 60 * 60 * 1000)
        const tightHi = new Date(utc.getTime() + 60 * 60 * 1000)
        fixture = await prisma.cupFixture.findFirst({
          where: {
            round,
            homeTeam:  null,
            awayTeam:  null,
            kickoffAt: { gte: tightLo, lte: tightHi },
          },
          orderBy: { kickoffAt: 'asc' },
          select:  {
            id: true, round: true, winnerTeam: true, homeTeam: true, awayTeam: true,
            homeScore: true,
            suggestedHomeScore: true, suggestedAwayScore: true, suggestedWinnerTeam: true,
            suggestedStatus: true, suggestedHomeTeam: true, suggestedAwayTeam: true,
          },
        })
        if (fixture) isTeamSuggestion = true
      }
    }

    if (!fixture) { skippedNoFixture += 1; continue }

    // Already committed — homeScore being non-null means the result
    // was applied (either by auto-apply or admin). Admin's committed
    // truth is final; never overwrite.
    if (fixture.homeScore !== null) continue

    const suggestedWinner = fdWinnerCode(m)
    const newHomeScore  = m.score.fullTime.home ?? null
    const newAwayScore  = m.score.fullTime.away ?? null
    const newStatus     = m.status as string
    const newHomeTeam   = isTeamSuggestion ? home : (fixture.suggestedHomeTeam ?? null)
    const newAwayTeam   = isTeamSuggestion ? away : (fixture.suggestedAwayTeam ?? null)

    // Auto-apply finished results. When football-data reports
    // FINISHED (or AWARDED for administratively decided matches)
    // with both scores present, commit directly instead of waiting
    // for a manual admin click. This keeps the leaderboard live
    // throughout a 120-match tournament without needing 120 button
    // presses. Admin can still override any committed result via
    // the PUT /api/admin/cup/fixtures/[id] endpoint.
    // Knockout guard: a shootout/awarded match can arrive FINISHED with a
    // level fullTime score and no resolvable winner (SUI–COL R16 did). A
    // group fixture without a winner is a legitimate draw — but committing
    // a winnerless KNOCKOUT result zeroes every prediction on the fixture
    // and the homeScore guard above stops any later sweep from fixing it.
    // Leave those as suggestion-only for the admin to resolve.
    if ((m.status === 'FINISHED' || m.status === 'AWARDED') && newHomeScore !== null && newAwayScore !== null
        && (fixture.round === 'group' || suggestedWinner !== null)) {
      const applyData: Record<string, unknown> = {
        homeScore:  newHomeScore,
        awayScore:  newAwayScore,
        winnerTeam: suggestedWinner ?? null,
        // Mirror into suggested fields so the admin UI shows ⚡ Auto
        suggestedHomeScore:  newHomeScore,
        suggestedAwayScore:  newAwayScore,
        suggestedWinnerTeam: suggestedWinner ?? null,
        suggestedStatus:     newStatus,
        suggestedAt:         new Date(),
      }
      if (isTeamSuggestion) {
        applyData.homeTeam          = home
        applyData.awayTeam          = away
        applyData.suggestedHomeTeam = home
        applyData.suggestedAwayTeam = away
      }
      await prisma.cupFixture.update({ where: { id: fixture.id }, data: applyData })
      await scoreFixture(fixture.id)
      // Bracket rescoring — QF/Final results move bracket scores.
      if (fixture.round === 'qf' || fixture.round === 'final') {
        await rescoreAllBrackets()
      }
      autoApplied += 1
      continue
    }

    // Not finished yet — write suggestion only.
    const unchanged =
      fixture.suggestedHomeScore  === newHomeScore  &&
      fixture.suggestedAwayScore  === newAwayScore  &&
      (fixture.suggestedWinnerTeam ?? null) === (suggestedWinner ?? null) &&
      (fixture.suggestedStatus ?? null)     === newStatus &&
      (fixture.suggestedHomeTeam ?? null)   === newHomeTeam &&
      (fixture.suggestedAwayTeam ?? null)   === newAwayTeam
    if (unchanged) continue

    const data: Record<string, unknown> = {
      suggestedHomeScore:  newHomeScore,
      suggestedAwayScore:  newAwayScore,
      suggestedWinnerTeam: suggestedWinner,
      suggestedStatus:     newStatus,
      suggestedAt:         new Date(),
    }
    if (isTeamSuggestion) {
      data.suggestedHomeTeam = home
      data.suggestedAwayTeam = away
      suggestedTeams += 1
    }

    await prisma.cupFixture.update({ where: { id: fixture.id }, data })
    suggested += 1
  }

  return {
    matchesScanned: fdMatches.length,
    suggested,
    autoApplied,
    suggestedTeams,
    skippedTeamMismatch,
    skippedNoFixture,
    window: { from: dateFrom, to: dateTo },
  }
}
