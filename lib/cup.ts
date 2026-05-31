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

// Scoring per round. winnerTeam matches pickedTeam → these points
// get written into CupPrediction.pointsAwarded by the admin result
// route. Group stage = 1 pt × 72 matches (max 72) drives engagement
// from Day 1 of the cup without dominating the leaderboard;
// knockouts (R32–Final) carry the weighted stakes.
export const ROUND_POINTS = {
  group:  1,
  r32:    3,
  r16:    5,
  qf:    10,
  sf:    20,
  final: 40,
} as const

export type CupRound = keyof typeof ROUND_POINTS

// Pre-tournament bracket scoring.
export const CHAMPION_POINTS     = 100
export const SEMIFINALIST_POINTS = 25  // × 4 = max 100

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

// Locks the pick UI when the fixture is about to start or already
// has. Mirrored on the server in the predict POST so a client that
// ignores `locked` still can't submit.
export function isFixtureLocked(kickoffAt: Date, now: Date = new Date()): boolean {
  return kickoffAt.getTime() <= now.getTime()
}

// The 48 confirmed qualifiers for the 2026 World Cup, as drawn into
// groups A–L on December 5, 2025 at the Kennedy Center. Each team's
// confederation is recorded for grouping in the bracket picker.
// Codes follow FIFA's three-letter standard (mostly matching ISO-3;
// CUW, HAI, SCO, CPV, COD diverge in the usual FIFA-vs-ISO ways).
//
// Used by the bracket pick UI (champion + semifinalist dropdowns)
// and by the predict POST validator. The validator pairs this with
// the per-fixture homeTeam/awayTeam check.
export const CUP_TEAMS: { code: string; name: string; flag: string; confederation: string }[] = [
  // CONMEBOL (6) — all in different groups except the rare clash
  { code: 'ARG', name: 'Argentina',          flag: '🇦🇷', confederation: 'CONMEBOL' },
  { code: 'BRA', name: 'Brazil',             flag: '🇧🇷', confederation: 'CONMEBOL' },
  { code: 'URU', name: 'Uruguay',            flag: '🇺🇾', confederation: 'CONMEBOL' },
  { code: 'COL', name: 'Colombia',           flag: '🇨🇴', confederation: 'CONMEBOL' },
  { code: 'ECU', name: 'Ecuador',            flag: '🇪🇨', confederation: 'CONMEBOL' },
  { code: 'PAR', name: 'Paraguay',           flag: '🇵🇾', confederation: 'CONMEBOL' },
  // UEFA (16)
  { code: 'FRA', name: 'France',             flag: '🇫🇷', confederation: 'UEFA' },
  { code: 'ESP', name: 'Spain',              flag: '🇪🇸', confederation: 'UEFA' },
  { code: 'GER', name: 'Germany',            flag: '🇩🇪', confederation: 'UEFA' },
  { code: 'ENG', name: 'England',            flag: '🇬🇧', confederation: 'UEFA' },
  { code: 'POR', name: 'Portugal',           flag: '🇵🇹', confederation: 'UEFA' },
  { code: 'NED', name: 'Netherlands',        flag: '🇳🇱', confederation: 'UEFA' },
  { code: 'BEL', name: 'Belgium',            flag: '🇧🇪', confederation: 'UEFA' },
  { code: 'CRO', name: 'Croatia',            flag: '🇭🇷', confederation: 'UEFA' },
  { code: 'SUI', name: 'Switzerland',        flag: '🇨🇭', confederation: 'UEFA' },
  { code: 'AUT', name: 'Austria',            flag: '🇦🇹', confederation: 'UEFA' },
  { code: 'TUR', name: 'Türkiye',            flag: '🇹🇷', confederation: 'UEFA' },
  { code: 'NOR', name: 'Norway',             flag: '🇳🇴', confederation: 'UEFA' },
  { code: 'SWE', name: 'Sweden',             flag: '🇸🇪', confederation: 'UEFA' },
  { code: 'SCO', name: 'Scotland',           flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', confederation: 'UEFA' },
  { code: 'CZE', name: 'Czechia',            flag: '🇨🇿', confederation: 'UEFA' },
  { code: 'BIH', name: 'Bosnia-Herzegovina', flag: '🇧🇦', confederation: 'UEFA' },
  // CONCACAF (5, incl. three hosts)
  { code: 'USA', name: 'United States',      flag: '🇺🇸', confederation: 'CONCACAF' },
  { code: 'MEX', name: 'Mexico',             flag: '🇲🇽', confederation: 'CONCACAF' },
  { code: 'CAN', name: 'Canada',             flag: '🇨🇦', confederation: 'CONCACAF' },
  { code: 'PAN', name: 'Panama',             flag: '🇵🇦', confederation: 'CONCACAF' },
  { code: 'HAI', name: 'Haiti',              flag: '🇭🇹', confederation: 'CONCACAF' },
  { code: 'CUW', name: 'Curaçao',            flag: '🇨🇼', confederation: 'CONCACAF' },
  // CAF (9)
  { code: 'MAR', name: 'Morocco',            flag: '🇲🇦', confederation: 'CAF' },
  { code: 'SEN', name: 'Senegal',            flag: '🇸🇳', confederation: 'CAF' },
  { code: 'EGY', name: 'Egypt',              flag: '🇪🇬', confederation: 'CAF' },
  { code: 'ALG', name: 'Algeria',            flag: '🇩🇿', confederation: 'CAF' },
  { code: 'CIV', name: 'Ivory Coast',        flag: '🇨🇮', confederation: 'CAF' },
  { code: 'TUN', name: 'Tunisia',            flag: '🇹🇳', confederation: 'CAF' },
  { code: 'GHA', name: 'Ghana',              flag: '🇬🇭', confederation: 'CAF' },
  { code: 'ZAF', name: 'South Africa',       flag: '🇿🇦', confederation: 'CAF' },
  { code: 'CPV', name: 'Cape Verde',         flag: '🇨🇻', confederation: 'CAF' },
  { code: 'COD', name: 'DR Congo',           flag: '🇨🇩', confederation: 'CAF' },
  // AFC (8)
  { code: 'JPN', name: 'Japan',              flag: '🇯🇵', confederation: 'AFC' },
  { code: 'KOR', name: 'South Korea',        flag: '🇰🇷', confederation: 'AFC' },
  { code: 'IRN', name: 'Iran',               flag: '🇮🇷', confederation: 'AFC' },
  { code: 'AUS', name: 'Australia',          flag: '🇦🇺', confederation: 'AFC' },
  { code: 'KSA', name: 'Saudi Arabia',       flag: '🇸🇦', confederation: 'AFC' },
  { code: 'QAT', name: 'Qatar',              flag: '🇶🇦', confederation: 'AFC' },
  { code: 'UZB', name: 'Uzbekistan',         flag: '🇺🇿', confederation: 'AFC' },
  { code: 'JOR', name: 'Jordan',             flag: '🇯🇴', confederation: 'AFC' },
  { code: 'IRQ', name: 'Iraq',               flag: '🇮🇶', confederation: 'AFC' },
  // OFC (1)
  { code: 'NZL', name: 'New Zealand',        flag: '🇳🇿', confederation: 'OFC' },
]

// Group-stage assignments from the draw on Dec 5, 2025. Each entry
// is ordered [seed1, seed2, seed3, seed4] following FIFA's pot
// allocation (Pot 1 → Pot 4). Seeding matters for the standard
// matchday rotation in seed-cup.ts: T1×T2 + T3×T4 on MD1, T1×T3 +
// T2×T4 on MD2, T1×T4 + T2×T3 on MD3 (last two simultaneous).
export const CUP_GROUPS: Record<string, [string, string, string, string]> = {
  A: ['MEX', 'KOR', 'ZAF', 'CZE'],   // hosts in pot 1
  B: ['CAN', 'SUI', 'QAT', 'BIH'],
  C: ['BRA', 'MAR', 'SCO', 'HAI'],
  D: ['USA', 'PAR', 'AUS', 'TUR'],
  E: ['GER', 'ECU', 'CIV', 'CUW'],
  F: ['NED', 'JPN', 'SWE', 'TUN'],
  G: ['BEL', 'EGY', 'IRN', 'NZL'],
  H: ['ESP', 'URU', 'KSA', 'CPV'],
  I: ['FRA', 'SEN', 'NOR', 'IRQ'],
  J: ['ARG', 'ALG', 'AUT', 'JOR'],
  K: ['POR', 'COL', 'UZB', 'COD'],
  L: ['ENG', 'CRO', 'GHA', 'PAN'],
}

export const TEAM_BY_CODE = new Map(CUP_TEAMS.map(t => [t.code, t]))

export function teamLabel(code: string | null | undefined): string {
  if (!code) return '—'
  const t = TEAM_BY_CODE.get(code)
  return t ? `${t.flag} ${t.name}` : code
}

// Helpers for the predict POST validator. The fixture may have
// known teams (regular case) or labels only (early knockout slots).
// In the known case, pickedTeam must match home or away; in the
// label-only case, pickedTeam just has to be a valid ISO-3 in
// CUP_TEAMS (any team could end up in that slot once the bracket
// fills in).
export function isValidTeamCode(code: string): boolean {
  return TEAM_BY_CODE.has(code)
}

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
