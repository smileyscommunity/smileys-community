// Handbook homepage search — the matching logic, kept pure and separate from
// the client component so it's testable.
//
// The corpus is small (single-digit articles today, dozens at maturity), so
// search runs entirely client-side over an index the server passes down: no
// API round-trip, results as you type. If the Handbook ever outgrows this,
// the component swaps to an API without the matching semantics changing.
//
// Matching is Turkish-aware: members type "ikamet" without thinking about
// whether the article says "İkamet", and "eczane" should match "Eczane".
// Both sides are case-folded and stripped of diacritics before comparing, so
// s/ş, c/ç, i/ı/İ all collapse together.

export type HandbookSearchItem = {
  slug:     string
  title:    string
  excerpt:  string
  category: string          // canonical display label
  emoji:    string
  reviewed: string | null   // public review line, or null (never fake a date)
  minutes:  number
  tags:     string[]
}

export type HandbookSearchResult = HandbookSearchItem & { score: number }

/** Case-fold and strip diacritics for forgiving Turkish/English matching.
 *  toLowerCase first: 'İ' lowercases to 'i' + combining dot, and NFD then
 *  strips the dot along with the cedillas and umlauts. Dotless 'ı' doesn't
 *  decompose, so it's mapped by hand. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
}

// Field weights: a title hit is a stronger signal than a tag hit, which beats
// a mention buried in the summary.
const TITLE_WEIGHT   = 3
const TAG_WEIGHT     = 2
const EXCERPT_WEIGHT = 1

/** All items matching the query, best first. Terms are ANDed — every word the
 *  member typed must appear somewhere in the article's searchable text — so
 *  adding words narrows the results, which is what typing more should do.
 *  Empty/whitespace queries return nothing: the rest of the page handles
 *  browsing, search only answers questions. */
export function searchHandbook(items: HandbookSearchItem[], query: string): HandbookSearchResult[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const results: HandbookSearchResult[] = []
  for (const item of items) {
    const title   = fold(item.title)
    const tags    = fold(item.tags.join(' ') + ' ' + item.category)
    const excerpt = fold(item.excerpt)

    let score = 0
    let matched = true
    for (const term of terms) {
      if      (title.includes(term))   score += TITLE_WEIGHT
      else if (tags.includes(term))    score += TAG_WEIGHT
      else if (excerpt.includes(term)) score += EXCERPT_WEIGHT
      else { matched = false; break }
    }
    if (matched) results.push({ ...item, score })
  }

  // Stable sort: equal scores keep the caller's (editorially curated) order.
  return results.sort((a, b) => b.score - a.score)
}
