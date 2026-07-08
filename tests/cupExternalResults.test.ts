import { describe, it, expect } from 'vitest'
import { fdWinnerCode, type FdMatch } from '@/lib/cup-external-results'

const match = (over: Partial<FdMatch['score']>, status: FdMatch['status'] = 'FINISHED'): FdMatch => ({
  id: 1,
  utcDate: '2026-07-07T20:00:00Z',
  status,
  stage: 'LAST_16',
  homeTeam: { id: 1, name: 'Switzerland', shortName: 'SUI', tla: 'SUI' },
  awayTeam: { id: 2, name: 'Colombia', shortName: 'COL', tla: 'COL' },
  score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null }, ...over },
})

describe('fdWinnerCode', () => {
  it('uses the explicit winner field when present', () => {
    expect(fdWinnerCode(match({ winner: 'HOME_TEAM' }))).toBe('SUI')
    expect(fdWinnerCode(match({ winner: 'AWAY_TEAM' }))).toBe('COL')
  })

  it('returns null for draws', () => {
    expect(fdWinnerCode(match({ winner: 'DRAW', fullTime: { home: 1, away: 1 } }))).toBeNull()
  })

  // The 2026-07-07 SUI–COL regression: FINISHED shootout with winner
  // left null by FD. fullTime includes shootout goals → decisive.
  it('derives the winner from fullTime when FD leaves winner null on a finished shootout', () => {
    expect(fdWinnerCode(match({
      winner: null, duration: 'PENALTY_SHOOTOUT',
      fullTime: { home: 4, away: 3 },
      penalties: { home: 3, away: 3 },
    }))).toBe('SUI')
  })

  it('falls back to the shootout tally when fullTime is level or missing', () => {
    expect(fdWinnerCode(match({
      winner: null, duration: 'PENALTY_SHOOTOUT',
      fullTime: { home: 0, away: 0 },
      penalties: { home: 4, away: 2 },
    }))).toBe('SUI')
  })

  it('never derives a winner for unfinished matches', () => {
    expect(fdWinnerCode(match({ winner: null, fullTime: { home: 2, away: 0 } }, 'IN_PLAY'))).toBeNull()
    expect(fdWinnerCode(match({ winner: null, fullTime: { home: 2, away: 0 } }, 'TIMED'))).toBeNull()
  })

  it('returns null when fullTime and penalties are both level', () => {
    expect(fdWinnerCode(match({
      winner: null, duration: 'PENALTY_SHOOTOUT',
      fullTime: { home: 1, away: 1 },
      penalties: { home: 3, away: 3 },
    }))).toBeNull()
  })
})
