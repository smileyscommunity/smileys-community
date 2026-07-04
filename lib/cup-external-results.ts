// Thin client for football-data.org — pulls scheduled + finished
// matches for the FIFA World Cup so the cup-results sweeper can
// write per-fixture suggestions that admin then approves with one
// click in the fixtures admin UI.
//
// Why football-data.org: free tier (10 req/min) handles the cup at
// our cadence (one /matches call per cron tick, every 5 min),
// World Cup is on the free competitions list, REST is simple, no
// SDK needed. Sign-up at football-data.org/client/register.
//
// Why hybrid (suggest, not auto-commit): a wrong API result lands
// as prediction-scoring truth. Asking admin to confirm with one
// tap costs almost nothing and keeps the human in the loop.

import { TEAM_BY_CODE } from './cup-data'

// FIFA World Cup competition code on football-data.org. Their
// numeric ID is 2000; the string code 'WC' resolves to the same
// row and is more readable.
const FD_COMPETITION_CODE = 'WC'

// Base URL. The API is HTTPS-only; we never want to silently
// downgrade.
const FD_BASE = 'https://api.football-data.org/v4'

// football-data.org match status values we care about. POSTPONED
// + CANCELLED would need kickoff rescheduling; we ignore them
// in the sweeper (admin manages those by hand for now).
export type FdMatchStatus =
  | 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'PAUSED'
  | 'FINISHED' | 'SUSPENDED' | 'POSTPONED' | 'CANCELLED' | 'AWARDED'

export interface FdMatch {
  id:        number
  utcDate:   string         // ISO timestamp
  status:    FdMatchStatus
  // Bracket round identifier. We map it to our internal round
  // values via fdStageToCupRound() so the sweeper can pick up
  // resolved knockout teams once the prior round wraps.
  stage?:    string         // 'GROUP_STAGE' | 'ROUND_OF_32' | 'LAST_16' | 'QUARTER_FINALS' | 'SEMI_FINALS' | 'FINAL' | ...
  homeTeam:  { id: number; name: string; shortName: string | null; tla: string | null }
  awayTeam:  { id: number; name: string; shortName: string | null; tla: string | null }
  score: {
    winner:   'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
    duration: string                                       // 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT'
    fullTime: { home: number | null; away: number | null }
  }
}

// Our internal round identifiers. Keep this list in sync with the
// CupFixture.round column values in schema.prisma.
export type CupRound = 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'

// football-data.org's `stage` value → our internal round name.
// FD historically used LAST_16 for the round of 16 and follows the
// same LAST_N pattern for the 48-team format's round of 32. Map
// both LAST_N and the ROUND_OF_N aliases so we don't regress if
// FD ever normalises to the latter.
export function fdStageToCupRound(stage?: string): CupRound | null {
  switch (stage) {
    case 'GROUP_STAGE':       return 'group'
    case 'ROUND_OF_32':       return 'r32'
    case 'LAST_32':           return 'r32'
    case 'ROUND_OF_16':       return 'r16'
    case 'LAST_16':           return 'r16'
    case 'QUARTER_FINALS':    return 'qf'
    case 'SEMI_FINALS':       return 'sf'
    case 'FINAL':             return 'final'
    case 'THIRD_PLACE':       return null  // we don't model the third-place playoff
    default:                  return null
  }
}

interface FdMatchesResponse {
  matches: FdMatch[]
}

// One API call per sweep — pulls every World Cup match between
// dateFrom and dateTo (inclusive). Caller filters by status +
// matches them against our CupFixture rows.
export async function fetchCupMatches(dateFrom: string, dateTo: string): Promise<FdMatch[]> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY not configured')

  const url = `${FD_BASE}/competitions/${FD_COMPETITION_CODE}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': apiKey },
    // Disable Next.js's default fetch caching — we explicitly
    // want fresh data on every cron tick, not a 60s-old cached
    // response if a build happened to inline it.
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`football-data ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const data = (await res.json()) as FdMatchesResponse
  return data.matches ?? []
}

// Maps a football-data.org TLA (three-letter acronym, e.g. "FRA",
// "ARG") to our ISO-3 team code. football-data.org's TLAs are
// almost identical to ISO 3166-1 alpha-3 for World Cup teams —
// most resolve 1:1. Edge cases get listed here.
const FD_TLA_OVERRIDES: Record<string, string> = {
  // football-data.org TLA → our internal ISO-3 code, for cases where
  // the two differ. Add here as mismatches surface in production.
  RSA: 'ZAF',   // South Africa: football-data uses RSA, we store ZAF
  BOS: 'BIH',   // Bosnia-Herzegovina: football-data sometimes uses BOS
  SKO: 'KOR',   // South Korea: football-data sometimes uses SKO
  COR: 'KOR',   // South Korea: another alias seen in older API versions
  CUR: 'CUW',   // Curaçao: football-data may use CUR instead of CUW
  NCU: 'CUW',   // Curaçao: another possible alias
  ANT: 'CUW',   // Curaçao: legacy Netherlands Antilles code
  HAI: 'HAI',   // Haiti: ensure HAI passes through directly
  CIV: 'CIV',   // Côte d'Ivoire: ensure direct pass-through
  WAL: 'WAL',   // Wales: ensure direct pass-through
  URY: 'URU',   // Uruguay: football-data uses URY, we store URU
}

export function fdTlaToCupCode(tla: string | null | undefined): string | null {
  if (!tla) return null
  const override = FD_TLA_OVERRIDES[tla]
  if (override) return TEAM_BY_CODE.has(override) ? override : null
  return TEAM_BY_CODE.has(tla) ? tla : null
}

// Derive the winning team's ISO code from a football-data score
// object. Returns null for draws (group stage allows draws — no
// winner), for matches that haven't resolved (winner === null),
// or for matches where we can't resolve either team's TLA.
export function fdWinnerCode(match: FdMatch): string | null {
  const w = match.score.winner
  if (!w || w === 'DRAW') return null
  const homeCode = fdTlaToCupCode(match.homeTeam.tla)
  const awayCode = fdTlaToCupCode(match.awayTeam.tla)
  if (w === 'HOME_TEAM') return homeCode
  if (w === 'AWAY_TEAM') return awayCode
  return null
}
