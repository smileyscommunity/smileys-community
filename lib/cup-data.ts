// Client-safe cup constants — the data side of lib/cup.ts. Lives
// in its own file because lib/cup.ts pulls in Prisma + server-only
// helpers (scoreFixture, rescoreAllBrackets, isApprovedMember,
// tournamentStartAt) which can't ship to the client bundle. The
// page-level mirrors of TEAMS / teamLabel / ROUND_LABEL used to
// duplicate this data three times (server + member page + admin
// page), drifting whenever any of them changed.
//
// Now: this file is the single source. lib/cup.ts re-exports from
// here for server-side callers; the page files import directly.

export type CupRound = 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'

// Scoring per round. winnerTeam matches pickedTeam → these points
// get written into CupPrediction.pointsAwarded by the admin result
// route. Group stage = 1 pt × 72 matches (max 72) drives engagement
// from Day 1 of the cup without dominating the leaderboard;
// knockouts (R32–Final) carry the weighted stakes.
export const ROUND_POINTS: Record<CupRound, number> = {
  group:  1,
  r32:    3,
  r16:    5,
  qf:    10,
  sf:    20,
  final: 40,
}

// Pre-tournament bracket scoring.
export const CHAMPION_POINTS     = 100
export const SEMIFINALIST_POINTS = 25  // × 4 = max 100

// Display labels per round, used by both /cup and /admin/cup.
export const ROUND_LABEL: Record<CupRound, string> = {
  group: 'Group stage', r32: 'Round of 32', r16: 'Round of 16',
  qf: 'Quarterfinals',  sf:  'Semifinals',  final: 'Final',
}

// The 48 confirmed qualifiers for the 2026 World Cup, as drawn into
// groups A–L on December 5, 2025 at the Kennedy Center. Codes follow
// FIFA's three-letter standard (mostly matching ISO-3; CUW, HAI,
// SCO, CPV, COD diverge in the usual FIFA-vs-ISO ways).
//
// Used by the bracket pick UI (champion + semifinalist dropdowns),
// the predict POST validator, and the admin team-fill dropdowns.
export const CUP_TEAMS: { code: string; name: string; flag: string; confederation: string }[] = [
  // CONMEBOL (6)
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

export const TEAM_BY_CODE = new Map(CUP_TEAMS.map(t => [t.code, t]))

export function teamLabel(code: string | null | undefined): string {
  if (!code) return '—'
  const t = TEAM_BY_CODE.get(code)
  return t ? `${t.flag} ${t.name}` : code
}

export function isValidTeamCode(code: string): boolean {
  return TEAM_BY_CODE.has(code)
}

// Group-stage assignments from the draw on Dec 5, 2025. Each entry
// is ordered [seed1, seed2, seed3, seed4] following FIFA's pot
// allocation (Pot 1 → Pot 4). Used by scripts/seed-cup.ts for the
// bootstrap rows; scripts/fix-group-fixtures.ts overlays the real
// FIFA schedule on top.
export const CUP_GROUPS: Record<string, [string, string, string, string]> = {
  A: ['MEX', 'KOR', 'ZAF', 'CZE'],
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
