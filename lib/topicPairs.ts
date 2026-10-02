// Stories and Handbook articles that answer the same broad question from
// different angles: a general overview written as a story, and a step-by-step
// guide in the Handbook. They share no copied text (checked 2026-10-02: 0–1
// shared 5-word phrases per pair), so neither is a duplicate to redirect —
// but searchers and Google saw two similar pages with no relationship. Each
// now names the other: the overview sends readers to the guide, the guide to
// the overview, and the two stop reading as competitors.
//
// Editorial, by slug. Add a pair only for two live pages on one topic.

export const TOPIC_PAIRS: { overview: string; guide: string }[] = [
  { overview: 'banking-money-in-istanbul-what-expats-need-to-know',          guide: 'opening-turkish-bank-account' },
  { overview: 'healthcare-in-istanbul-what-expats-actually-need-to-know',    guide: 'healthcare-in-istanbul-how-the-system-works' },
  { overview: 'finding-an-apartment-in-istanbul-what-nobody-tells-you',      guide: 'istanbul-apartment-hunting-guide' },
  { overview: 'getting-around-istanbul-what-expats-need-to-know',            guide: 'istanbulkart-mastery' },
  { overview: 'safety-in-istanbul-what-expats-actually-need-to-know',        guide: 'scams-tourist-traps-in-t-rkiye-how-to-stay-safe-without-becoming-paran' },
]

/** The Handbook guide for a story that is its topic's overview, or null. */
export function guideForOverview(postSlug: string): string | null {
  return TOPIC_PAIRS.find(p => p.overview === postSlug)?.guide ?? null
}

/** The overview story for a Handbook guide, or null. */
export function overviewForGuide(handbookSlug: string): string | null {
  return TOPIC_PAIRS.find(p => p.guide === handbookSlug)?.overview ?? null
}
