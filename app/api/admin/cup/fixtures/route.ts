import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// GET /api/admin/cup/fixtures
//
// Admin-only fixture list. Returns the same shape the public
// /api/cup/fixtures endpoint does PLUS the suggested* columns the
// auto-scoring sweeper writes — admin UI needs them to render the
// "⚡ Auto" badges and Apply / Apply teams buttons.
//
// Stripped from the public endpoint so a curious member can't hit
// the API directly and see "FRA wins 2-1" before admin commits
// the result. The data is publicly available via football-data.org
// and FIFA, but our intermediate-state copy shouldn't leak through
// our own surfaces.

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const fixtures = await prisma.cupFixture.findMany({
    orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, round: true, group: true,
      homeTeam: true, awayTeam: true,
      homeLabel: true, awayLabel: true,
      kickoffAt: true, venue: true,
      winnerTeam: true, homeScore: true, awayScore: true,
      points: true,
      suggestedHomeScore: true, suggestedAwayScore: true,
      suggestedWinnerTeam: true, suggestedStatus: true, suggestedAt: true,
      suggestedHomeTeam: true, suggestedAwayTeam: true,
    },
  })
  return NextResponse.json({ fixtures })
}
