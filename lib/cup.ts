// Smileys Cup 2026 — shared constants + helpers across the
// member-facing pick UI, the predict POST, the leaderboard
// aggregator, and the admin result-entry route. Single source of
// truth for scoring + team list so a tweak in one place can't drift
// the others.
//
// Anti-Goodhart: scoring values are tuned so a casual fan with just
// a champion pick (100) can still finish in the top quarter on
// luck, while an engaged fan picking every knockout has a
// 280-point ceiling. Group stage carries 0 — too much data entry,
// low signal, and the math gets boring.

import { prisma } from '@/lib/prisma'
import type { Prisma, PrismaClient } from '@prisma/client'

// Same shape lib/spotsLeft.ts uses: callers inside an interactive
// transaction pass their tx client so the scoring commits (or rolls
// back) atomically with the fixture write that made it necessary.
type Db = PrismaClient | Prisma.TransactionClient
import {
  CUP_TEAMS,
  CUP_GROUPS,
  TEAM_BY_CODE,
  ROUND_POINTS,
  ROUND_LABEL,
  CHAMPION_POINTS,
  SEMIFINALIST_POINTS,
  teamLabel,
  isValidTeamCode,
  isFixtureLocked,
  type CupRound,
} from '@/lib/cup-data'

// The Cup's clock lives in cup-data (client-safe); re-exported so server
// code that already imports from here keeps one import.
export { CUP_TZ } from './cup-data'

// Re-export the client-safe constants so existing server-side
// callers (e.g. scripts/archive/cup-2026/seed-cup.ts, /api/admin/cup, /api/cup/*)
// don't need to change their imports.
export {
  CUP_TEAMS,
  CUP_GROUPS,
  TEAM_BY_CODE,
  ROUND_POINTS,
  ROUND_LABEL,
  CHAMPION_POINTS,
  SEMIFINALIST_POINTS,
  teamLabel,
  isValidTeamCode,
  isFixtureLocked,
}
export type { CupRound }

// Bracket pick lockout — set to the first fixture's kickoffAt
// dynamically (read at request time so a schedule shift can't lock
// people out early). Keeps a single source of truth: the first row
// in CupFixture ordered by kickoffAt.
export async function tournamentStartAt(): Promise<Date | null> {
  const first = await prisma.cupFixture.findFirst({
    orderBy: { kickoffAt: 'asc' },
    select:  { kickoffAt: true },
  })
  return first?.kickoffAt ?? null
}

// Helpers for the predict POST validator. The fixture may have
// known teams (regular case) or labels only (early knockout slots).
// In the known case, pickedTeam must match home or away; in the
// label-only case, pickedTeam just has to be a valid ISO-3 in
// CUP_TEAMS (any team could end up in that slot once the bracket
// fills in).
export function isPickAllowedForFixture(
  pick: string,
  fixture: { homeTeam: string | null; awayTeam: string | null },
): boolean {
  if (!isValidTeamCode(pick)) return false
  if (fixture.homeTeam && fixture.awayTeam) {
    return pick === fixture.homeTeam || pick === fixture.awayTeam
  }
  return true  // Knockout slot is still TBD — any qualified team is allowed
}

// Gate for cup write endpoints (/api/cup/predict, /api/cup/bracket
// POST). Any approved Smileys member plays — no second-level opt-in.
// We do an inline status lookup rather than trusting the JWT's role
// claim since pending/banned/suspended state changes mid-session
// shouldn't leak through a stale token.
export async function isApprovedMember(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { status: true },
  })
  return user?.status === 'approved'
}

// Score every prediction for one fixture against its winnerTeam.
// The admin result-entry route passes its transaction client so the
// fixture write and the scoring land atomically — the leaderboard
// never observes a fixture whose winnerTeam is set but whose
// predictions haven't been scored, and a crash between the two can't
// leave predictions permanently mis-scored (nothing revisits a
// fixture whose winnerTeam is already set).
// pickedTeam === winnerTeam earns the fixture's `points`; everyone
// else earns 0. When winnerTeam is null (admin cleared the result)
// every pointsAwarded resets to 0 too.
export async function scoreFixture(fixtureId: string, db: Db = prisma) {
  const fixture = await db.cupFixture.findUnique({
    where:  { id: fixtureId },
    select: { winnerTeam: true, points: true },
  })
  if (!fixture) return { scored: 0, points: 0 }
  if (!fixture.winnerTeam) {
    const cleared = await db.cupPrediction.updateMany({
      where: { fixtureId },
      data:  { pointsAwarded: 0 },
    })
    return { scored: cleared.count, points: 0 }
  }
  // Sequential, not Promise.all — inside an interactive transaction the
  // ops serialize on one connection anyway, and parallel awaits on a tx
  // client are an antipattern.
  const winners = await db.cupPrediction.updateMany({
    where: { fixtureId, pickedTeam: fixture.winnerTeam },
    data:  { pointsAwarded: fixture.points },
  })
  const losers = await db.cupPrediction.updateMany({
    where: { fixtureId, pickedTeam: { not: fixture.winnerTeam } },
    data:  { pointsAwarded: 0 },
  })
  return { scored: winners.count + losers.count, points: fixture.points }
}

// Recompute bracket scores for every user. Cheap (one row per
// user, max a few hundred) so we just run it whenever any SF/Final
// fixture result changes. Champion = winner of the Final (100 pts);
// semifinalists = the 4 teams that won the QFs (25 pts each, max
// 100). Earlier rounds don't move the bracket score.
export async function rescoreAllBrackets() {
  const [qfs, final, brackets] = await Promise.all([
    prisma.cupFixture.findMany({ where: { round: 'qf' },    select: { winnerTeam: true } }),
    prisma.cupFixture.findFirst({ where: { round: 'final' }, select: { winnerTeam: true } }),
    prisma.cupBracketPick.findMany({ select: { id: true, championPick: true, semifinalists: true } }),
  ])
  const semifinalists = new Set(qfs.map(q => q.winnerTeam).filter((t): t is string => !!t))
  const champion      = final?.winnerTeam ?? null

  await prisma.$transaction(brackets.map(b => {
    const sfMatches = b.semifinalists.filter(s => semifinalists.has(s)).length
    const championCorrect = champion !== null && b.championPick === champion
    const points = (championCorrect ? CHAMPION_POINTS : 0) + sfMatches * SEMIFINALIST_POINTS
    return prisma.cupBracketPick.update({
      where: { id: b.id },
      data:  { pointsAwarded: points },
    })
  }))
  return { brackets: brackets.length, semifinalists: semifinalists.size, championKnown: champion !== null }
}
