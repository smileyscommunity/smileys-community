import { describe, it, expect } from 'vitest'
import { classifyCityMaturity, CITY_MATURITY } from '@/lib/cityMaturity'

// Maturity exists to stop a young city's public page from reading as a dead
// one ("1 member") and to flag a stuck city to ops. Its whole value is that
// it is DERIVED — these pin the boundaries so a threshold tweak is a
// deliberate, reviewed act, and pin the two real cities it was tuned on.

const base = { members: 0, upcomingEvents: 0, hostedClubs: 0, memberActivity30d: 0 }

describe('classifyCityMaturity', () => {
  it('Bodrum today (1 member, 1 event, 1 hosted club) is seeding', () => {
    expect(classifyCityMaturity({ members: 1, upcomingEvents: 1, hostedClubs: 1, memberActivity30d: 0 }))
      .toBe(CITY_MATURITY.Seeding)
  })

  it('Istanbul today (~1.5k members, dozens of events, many hosts) is self-sustaining', () => {
    expect(classifyCityMaturity({ members: 1500, upcomingEvents: 35, hostedClubs: 58, memberActivity30d: 40 }))
      .toBe(CITY_MATURITY.SelfSustaining)
  })

  it('forming needs all three: people, something to join, someone to run it', () => {
    const forming = { members: 20, upcomingEvents: 1, hostedClubs: 1, memberActivity30d: 0 }
    expect(classifyCityMaturity(forming)).toBe(CITY_MATURITY.Forming)
    // Drop any one leg and it falls back to seeding.
    expect(classifyCityMaturity({ ...forming, members: 19 })).toBe(CITY_MATURITY.Seeding)
    expect(classifyCityMaturity({ ...forming, upcomingEvents: 0 })).toBe(CITY_MATURITY.Seeding)
    expect(classifyCityMaturity({ ...forming, hostedClubs: 0 })).toBe(CITY_MATURITY.Seeding)
  })

  it('self-sustaining requires member-created activity, not just size', () => {
    // A big city where only admins create things is forming, not self-sustaining.
    expect(classifyCityMaturity({ members: 500, upcomingEvents: 10, hostedClubs: 10, memberActivity30d: 0 }))
      .toBe(CITY_MATURITY.Forming)
  })

  it('an empty city is seeding, never anything else', () => {
    expect(classifyCityMaturity(base)).toBe(CITY_MATURITY.Seeding)
  })
})
