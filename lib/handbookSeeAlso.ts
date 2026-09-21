// Two articles that answer the same question — a city-local one written
// later beside the national one it overlaps. Neither mentioned the other,
// so a reader landing on one could not know the second existed (and "Start
// here" points at the national one). Until they are merged, each names the
// other. Editorial, by slug, both directions.
const PAIRS: [string, string][] = [
  ['istanbul-residence-permit-guide', 'residence-permit-first-application'],
  ['istanbul-bank-account-guide',     'opening-turkish-bank-account'],
]

const SEE_ALSO = new Map<string, string>()
for (const [a, b] of PAIRS) { SEE_ALSO.set(a, b); SEE_ALSO.set(b, a) }

/** The slug of the article this one overlaps with, or null. */
export function seeAlsoSlug(slug: string): string | null {
  return SEE_ALSO.get(slug) ?? null
}
