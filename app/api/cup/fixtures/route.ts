import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// GET /api/cup/fixtures
//
// Returns every fixture in the cup (knockouts in v1; group rows
// added later if we ever decide to score groups). Logged-out
// callers see the structure + the locked flag — no `yourPick`.
// Logged-in callers get `yourPick` populated for each fixture
// they've predicted. Members-only writes are gated in /api/cup/predict;
// this is read-only so the page can render the public bracket for
// non-members too (drives apply CTAs).
//
// `locked` is computed server-side at request time so a client
// that ignores it still can't submit (the predict POST runs the
// same check).

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  const now = new Date()

  const fixtures = await prisma.cupFixture.findMany({
    orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, round: true, group: true,
      homeTeam: true, awayTeam: true,
      homeLabel: true, awayLabel: true,
      kickoffAt: true, venue: true,
      winnerTeam: true, homeScore: true, awayScore: true,
      points: true,
      // Auto-scoring suggestion fields. Written by the
      // sweep-cup-results cron. Surfaced on every fixture row in
      // the admin UI so admin can one-click apply. Members /
      // visitors will see them too via the same endpoint, but
      // the member-side /cup page doesn't render them — saves
      // doing a separate query. suggestedHomeTeam / awayTeam
      // appear on TBD knockout fixtures once the prior round
      // wraps and football-data.org resolves the matchup.
      suggestedHomeScore: true, suggestedAwayScore: true,
      suggestedWinnerTeam: true, suggestedStatus: true, suggestedAt: true,
      suggestedHomeTeam: true, suggestedAwayTeam: true,
    },
  })

  const yourPicks: Record<string, { pickedTeam: string; submittedAt: Date; pointsAwarded: number }> = {}
  if (session) {
    const rows = await prisma.cupPrediction.findMany({
      where:  { userId: session.id, fixtureId: { in: fixtures.map(f => f.id) } },
      select: { fixtureId: true, pickedTeam: true, submittedAt: true, pointsAwarded: true },
    })
    for (const r of rows) {
      yourPicks[r.fixtureId] = {
        pickedTeam: r.pickedTeam,
        submittedAt: r.submittedAt,
        pointsAwarded: r.pointsAwarded,
      }
    }
  }

  return NextResponse.json({
    fixtures: fixtures.map(f => ({
      ...f,
      locked:   f.kickoffAt.getTime() <= now.getTime(),
      yourPick: yourPicks[f.id] ?? null,
    })),
  })
}
