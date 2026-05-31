import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchCupMatches, fdTlaToCupCode, fdWinnerCode } from '@/lib/cup-external-results'

// Cup auto-score sweeper. Pulls football-data.org's match list for
// the rolling [yesterday → today+1] window every 5 minutes (or
// whatever cadence the crontab fires), matches each result back
// to a CupFixture row, and writes the proposed score to the
// suggested* columns.
//
// Critical: the sweeper NEVER touches homeScore / awayScore /
// winnerTeam directly. Admin reviews the suggestion in the
// fixtures admin tab and clicks Apply to commit. That's the
// hybrid promise — speed of automation, safety of human review.
//
// Matching: each fixture is bound to a football-data match by
// (kickoff date, home TLA, away TLA). football-data's TLAs are
// almost 1:1 with our ISO-3 team codes — overrides live in
// lib/cup-external-results.ts.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. Refuses
// with 503 if CRON_SECRET isn't configured. Also refuses with
// 503 if FOOTBALL_DATA_API_KEY isn't set so a freshly-deployed
// box without the key doesn't silently 500 on every cron tick.

export const dynamic = 'force-dynamic'

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 503 })
  }
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (got !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.FOOTBALL_DATA_API_KEY) {
    return NextResponse.json({ error: 'FOOTBALL_DATA_API_KEY not configured on server' }, { status: 503 })
  }
  return null
}

// YYYY-MM-DD in UTC. football-data.org's date filters operate on
// UTC dates; a fixture that kicks off late Istanbul time can sit
// in a different UTC date than the local one. We pull a [yesterday,
// today+1] window so a match that finished after midnight UTC
// still lands.
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

async function runSweep() {
  const now      = new Date()
  const dateFrom = isoDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const dateTo   = isoDate(new Date(now.getTime() + 24 * 60 * 60 * 1000))

  // One API call. ~10 req/min free-tier ceiling means we have
  // plenty of headroom at 5-min cadence.
  const fdMatches = await fetchCupMatches(dateFrom, dateTo)

  let suggested = 0
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
        homeTeam: home,
        awayTeam: away,
        kickoffAt: { gte: lo, lte: hi },
      },
      select: { id: true, winnerTeam: true, homeScore: true, awayScore: true, suggestedStatus: true, suggestedAt: true },
    })
    if (!fixture) { skippedNoFixture += 1; continue }

    // Already committed — admin's truth is final, no overwrite.
    if (fixture.winnerTeam) continue

    const suggestedWinner = fdWinnerCode(m)
    const data = {
      suggestedHomeScore:  m.score.fullTime.home ?? null,
      suggestedAwayScore:  m.score.fullTime.away ?? null,
      suggestedWinnerTeam: suggestedWinner,
      suggestedStatus:     m.status,
      suggestedAt:         new Date(),
    }

    await prisma.cupFixture.update({
      where: { id: fixture.id },
      data,
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

export async function POST(req: NextRequest) {
  const auth = await authorize(req)
  if (auth) return auth
  try {
    const result = await runSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
