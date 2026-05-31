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

export const CUP_CLUB_SLUG = 'world-cup-2026'

// Scoring per round. winnerTeam matches pickedTeam → these points
// get written into CupPrediction.pointsAwarded by the admin result
// route. Group-stage = 0 by design.
export const ROUND_POINTS = {
  group:  0,
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

// ISO-3 team list — every confirmed qualifier for WC 2026. Used by
// the bracket pick UI (champion + semifinalist dropdowns) and by
// the predict POST validator. When a knockout fixture has known
// homeTeam + awayTeam, the validator additionally requires the
// pickedTeam to be one of those two — this list is the looser
// outer guard against malformed input.
//
// Includes the three hosts (USA, CAN, MEX) + qualifiers across
// confederations. As of seed date (May 2026) most qualifiers are
// confirmed. Admin can edit this constant if FIFA's list shifts.
export const CUP_TEAMS: { code: string; name: string; flag: string; confederation: string }[] = [
  // CONMEBOL
  { code: 'ARG', name: 'Argentina',     flag: '🇦🇷', confederation: 'CONMEBOL' },
  { code: 'BRA', name: 'Brazil',        flag: '🇧🇷', confederation: 'CONMEBOL' },
  { code: 'URU', name: 'Uruguay',       flag: '🇺🇾', confederation: 'CONMEBOL' },
  { code: 'COL', name: 'Colombia',      flag: '🇨🇴', confederation: 'CONMEBOL' },
  { code: 'ECU', name: 'Ecuador',       flag: '🇪🇨', confederation: 'CONMEBOL' },
  { code: 'PAR', name: 'Paraguay',      flag: '🇵🇾', confederation: 'CONMEBOL' },
  // UEFA
  { code: 'FRA', name: 'France',        flag: '🇫🇷', confederation: 'UEFA' },
  { code: 'ESP', name: 'Spain',         flag: '🇪🇸', confederation: 'UEFA' },
  { code: 'GER', name: 'Germany',       flag: '🇩🇪', confederation: 'UEFA' },
  { code: 'ENG', name: 'England',       flag: '🇬🇧', confederation: 'UEFA' },
  { code: 'POR', name: 'Portugal',      flag: '🇵🇹', confederation: 'UEFA' },
  { code: 'NED', name: 'Netherlands',   flag: '🇳🇱', confederation: 'UEFA' },
  { code: 'ITA', name: 'Italy',         flag: '🇮🇹', confederation: 'UEFA' },
  { code: 'BEL', name: 'Belgium',       flag: '🇧🇪', confederation: 'UEFA' },
  { code: 'CRO', name: 'Croatia',       flag: '🇭🇷', confederation: 'UEFA' },
  { code: 'SUI', name: 'Switzerland',   flag: '🇨🇭', confederation: 'UEFA' },
  { code: 'AUT', name: 'Austria',       flag: '🇦🇹', confederation: 'UEFA' },
  { code: 'DEN', name: 'Denmark',       flag: '🇩🇰', confederation: 'UEFA' },
  { code: 'POL', name: 'Poland',        flag: '🇵🇱', confederation: 'UEFA' },
  { code: 'TUR', name: 'Türkiye',       flag: '🇹🇷', confederation: 'UEFA' },
  { code: 'NOR', name: 'Norway',        flag: '🇳🇴', confederation: 'UEFA' },
  { code: 'SWE', name: 'Sweden',        flag: '🇸🇪', confederation: 'UEFA' },
  { code: 'SRB', name: 'Serbia',        flag: '🇷🇸', confederation: 'UEFA' },
  { code: 'UKR', name: 'Ukraine',       flag: '🇺🇦', confederation: 'UEFA' },
  // CONCACAF (incl. hosts)
  { code: 'USA', name: 'United States', flag: '🇺🇸', confederation: 'CONCACAF' },
  { code: 'MEX', name: 'Mexico',        flag: '🇲🇽', confederation: 'CONCACAF' },
  { code: 'CAN', name: 'Canada',        flag: '🇨🇦', confederation: 'CONCACAF' },
  { code: 'CRC', name: 'Costa Rica',    flag: '🇨🇷', confederation: 'CONCACAF' },
  { code: 'JAM', name: 'Jamaica',       flag: '🇯🇲', confederation: 'CONCACAF' },
  { code: 'PAN', name: 'Panama',        flag: '🇵🇦', confederation: 'CONCACAF' },
  // CAF
  { code: 'MAR', name: 'Morocco',       flag: '🇲🇦', confederation: 'CAF' },
  { code: 'SEN', name: 'Senegal',       flag: '🇸🇳', confederation: 'CAF' },
  { code: 'NGA', name: 'Nigeria',       flag: '🇳🇬', confederation: 'CAF' },
  { code: 'EGY', name: 'Egypt',         flag: '🇪🇬', confederation: 'CAF' },
  { code: 'ALG', name: 'Algeria',       flag: '🇩🇿', confederation: 'CAF' },
  { code: 'CIV', name: 'Ivory Coast',   flag: '🇨🇮', confederation: 'CAF' },
  { code: 'TUN', name: 'Tunisia',       flag: '🇹🇳', confederation: 'CAF' },
  { code: 'CMR', name: 'Cameroon',      flag: '🇨🇲', confederation: 'CAF' },
  { code: 'GHA', name: 'Ghana',         flag: '🇬🇭', confederation: 'CAF' },
  // AFC
  { code: 'JPN', name: 'Japan',         flag: '🇯🇵', confederation: 'AFC' },
  { code: 'KOR', name: 'South Korea',   flag: '🇰🇷', confederation: 'AFC' },
  { code: 'IRN', name: 'Iran',          flag: '🇮🇷', confederation: 'AFC' },
  { code: 'AUS', name: 'Australia',     flag: '🇦🇺', confederation: 'AFC' },
  { code: 'KSA', name: 'Saudi Arabia',  flag: '🇸🇦', confederation: 'AFC' },
  { code: 'QAT', name: 'Qatar',         flag: '🇶🇦', confederation: 'AFC' },
  { code: 'UZB', name: 'Uzbekistan',    flag: '🇺🇿', confederation: 'AFC' },
  { code: 'JOR', name: 'Jordan',        flag: '🇯🇴', confederation: 'AFC' },
  // OFC
  { code: 'NZL', name: 'New Zealand',   flag: '🇳🇿', confederation: 'OFC' },
]

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

// Gate for the predictions UI + APIs. Returns the club membership
// if the user is approved in the cup club, else null. Reused by
// /api/cup/fixtures (to include yourPick), /api/cup/predict, and
// /api/cup/bracket.
export async function getCupClubMembership(userId: string) {
  const club = await prisma.club.findUnique({
    where:  { slug: CUP_CLUB_SLUG },
    select: { id: true },
  })
  if (!club) return null
  const membership = await prisma.clubMembership.findUnique({
    where:  { userId_clubId: { userId, clubId: club.id } },
    select: { status: true, role: true },
  })
  return membership?.status === 'approved' ? { clubId: club.id, role: membership.role } : null
}
