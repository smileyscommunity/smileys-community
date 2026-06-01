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
      // suggested* fields intentionally NOT selected here. They're
      // visible only to admin/moderator via /api/admin/cup/fixtures.
      // The data ultimately comes from public football-data.org,
      // but we don't want our intermediate-state copy to leak
      // "FRA wins 2-1" to members through this endpoint before
      // admin commits the result.
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
