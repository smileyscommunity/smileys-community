import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf8')

// "🔥 Active this week" showed Dancing with "2 activities this week" when the
// club had no event, no post and nothing on. The two were one hangout entered
// twice, cancelled both times, for a date already past.
//
// The events and board-post queries beside it filter status ('published',
// 'active'); the hangout one filtered none, and 31 of the 77 hangouts ever
// created are cancelled. lib/clubHealth — which classifies the same clubs —
// already had the right filter, so this was one query that had not caught up.

describe('activity counts ignore hangouts that were called off', () => {
  it.each([
    ['app/api/clubs/route.ts', 'the clubs grid / Active this week strip'],
    ['lib/cities.ts',          'the city maturity signal'],
    ['lib/clubHealth.ts',      'the club health classifier (the reference)'],
  ])('%s excludes cancelled', (file) => {
    const src = read(file)
    const hangoutQuery = src.slice(src.indexOf('prisma.hangout.groupBy'))
    expect(hangoutQuery.slice(0, 400)).toContain("status: { not: 'cancelled' }")
  })

  it('the clubs grid still counts a hangout that already happened', () => {
    // 'expired' is what the sweeper sets once a hangout's time has passed.
    // Filtering to 'active' would drop those, and a meetup that took place
    // last Tuesday is exactly the activity this strip is meant to show —
    // only two hangouts network-wide are 'active' at any moment.
    const src = read('app/api/clubs/route.ts')
    const hangoutQuery = src.slice(src.indexOf('prisma.hangout.groupBy'), src.indexOf('prisma.hangout.groupBy') + 400)
    expect(hangoutQuery).not.toContain("status: 'active'")
  })

  it('the three sources of the number each filter for something real', () => {
    const src = read('app/api/clubs/route.ts')
    // events published, posts active, hangouts not cancelled — one number is
    // made of three queries and a gap in any of them inflates it.
    expect(src).toContain("status: 'published'")
    expect(src).toContain("status: 'active'")          // boardPost
    expect(src).toContain("status: { not: 'cancelled' }")  // hangout
  })
})
