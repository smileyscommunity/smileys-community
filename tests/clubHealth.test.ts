import { describe, it, expect } from 'vitest'
import { classifyClub, CLUB_FILTER_GROUPS } from '../lib/clubHealth'
import { CLUB_CATEGORIES } from '../lib/data'

const NOW = new Date('2026-08-05T12:00:00Z')
const base = {
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  upcomingEvents: 0,
  recentEvents: 0,
  recentConversations: 0,
  recentHangouts: 0,
}

describe('classifyClub', () => {
  it('archived wins over everything', () => {
    expect(classifyClub({ ...base, isActive: false, upcomingEvents: 5 }, NOW)).toBe('archived')
  })

  it('any recent or upcoming activity → active', () => {
    expect(classifyClub({ ...base, upcomingEvents: 1 }, NOW)).toBe('active')
    expect(classifyClub({ ...base, recentEvents: 1 }, NOW)).toBe('active')
    expect(classifyClub({ ...base, recentConversations: 1 }, NOW)).toBe('active')
    expect(classifyClub({ ...base, recentHangouts: 1 }, NOW)).toBe('active')
  })

  it('young club without activity → new, not quiet', () => {
    expect(classifyClub({ ...base, createdAt: new Date('2026-07-20T00:00:00Z') }, NOW)).toBe('new')
  })

  it('old club without activity → quiet', () => {
    expect(classifyClub(base, NOW)).toBe('quiet')
  })

  it('60-day boundary: 59 days old is new, 61 days old is quiet', () => {
    const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
    expect(classifyClub({ ...base, createdAt: days(59) }, NOW)).toBe('new')
    expect(classifyClub({ ...base, createdAt: days(61) }, NOW)).toBe('quiet')
  })
})

describe('CLUB_FILTER_GROUPS', () => {
  it('covers every stored category except the Exclusive badge', () => {
    const covered = new Set(CLUB_FILTER_GROUPS.flatMap(g => g.categories))
    const missing = CLUB_CATEGORIES.filter(c => c !== 'Exclusive' && !covered.has(c))
    expect(missing).toEqual([])
  })

  it('no category appears in two groups', () => {
    const all = CLUB_FILTER_GROUPS.flatMap(g => g.categories)
    expect(new Set(all).size).toBe(all.length)
  })
})
