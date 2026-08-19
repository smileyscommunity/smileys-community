// ── City maturity: how alive a city is, derived from data ──────────────────
// Status (coming_soon → preparing → live → paused) is a LIFECYCLE vocabulary:
// it says what's permitted — can people see the page, can they join. It says
// nothing about liquidity, which is why "Bodrum: live, 1 member" reads wrong:
// the status is correct, the city is just empty. Those are orthogonal, and
// overloading status to express both would rot the vocabulary.
//
// Maturity is the second dimension, and it is DERIVED — computed from counts,
// never stored, never admin-set. An admin who could set it would set it to
// flatter, and its whole value is that it can't lie:
//   seeding          the founding stage — too few people or nothing to join
//   forming          things to join exist: members, an upcoming event, a host
//   self_sustaining  members create things themselves without a push
//
// Two consumers, two jobs: public surfaces swap raw counts for stage-honest
// copy ("11 clubs forming · be one of the first" beats "1 member"), and the
// admin cities list gets an ops signal (a city stuck in seeding for months
// needs intervention, not a bigger hero image).
//
// Pure module — safe in client components; keep prisma out (the lib/cityStatus
// rule). The signals are computed in lib/cities.getStatsFor.

export const CITY_MATURITY = {
  Seeding:        'seeding',
  Forming:        'forming',
  SelfSustaining: 'self_sustaining',
} as const

export type CityMaturity = (typeof CITY_MATURITY)[keyof typeof CITY_MATURITY]

export interface MaturitySignals {
  members:           number   // approved, this city
  upcomingEvents:    number   // published, today or later
  hostedClubs:       number   // the city's own clubs with an approved host — someone to run things
  memberActivity30d: number   // hangouts posted in the last 30 days — members creating, not admins seeding
}

// Thresholds are deliberately coarse — this is a stage, not a score. They only
// need to sort Istanbul (1.5k members, dozens of events) from Bodrum (1 member)
// and leave headroom for a middle. Tune against real cities, not in theory.
export function classifyCityMaturity(s: MaturitySignals): CityMaturity {
  if (
    s.members >= 150 &&
    s.upcomingEvents >= 5 &&
    s.hostedClubs >= 5 &&
    s.memberActivity30d >= 8
  ) return CITY_MATURITY.SelfSustaining

  if (s.members >= 20 && s.upcomingEvents >= 1 && s.hostedClubs >= 1) {
    return CITY_MATURITY.Forming
  }

  return CITY_MATURITY.Seeding
}
