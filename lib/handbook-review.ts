// Handbook article freshness: reading time, review state, and official sources.
//
// The governing rule (brief §14): never show a review date that nobody earned.
// `updatedAt` is not a review — it moves on typo fixes and bulk migrations —
// so an article with no `lastReviewedAt` reads as "not yet reviewed" and shows
// no date at all. That honesty is the whole point of the field: a Handbook
// that lies about its freshness is worse than one that admits it's unsure.

import {
  REVIEW_INTERVAL_DAYS,
  categoryMeta,
  type Volatility,
} from './handbook-categories'

export type ReviewState =
  | 'current'       // reviewed within its interval
  | 'review-soon'   // inside the last quarter of its interval
  | 'needs-review'  // past its interval
  | 'unreviewed'    // never reviewed — show no date

const DAY_MS = 86_400_000

/** Days an article of this category may go between reviews, unless the
 *  article overrides it. Unknown categories fall back to the medium tier. */
export function reviewIntervalFor(
  category: string,
  override?: number | null,
): number {
  if (override && override > 0) return Math.floor(override)
  const tier: Volatility = categoryMeta(category)?.volatility ?? 'medium'
  return REVIEW_INTERVAL_DAYS[tier]
}

/** Review state as of `now`. Kept pure (now is injected) so it is testable
 *  and so a server render and a later revalidation agree on the boundary. */
export function reviewState(
  article: { category: string; lastReviewedAt: Date | string | null; reviewIntervalDays?: number | null },
  now: Date = new Date(),
): ReviewState {
  if (!article.lastReviewedAt) return 'unreviewed'
  const reviewed = new Date(article.lastReviewedAt)
  if (Number.isNaN(reviewed.getTime())) return 'unreviewed'

  const interval = reviewIntervalFor(article.category, article.reviewIntervalDays)
  const ageDays  = (now.getTime() - reviewed.getTime()) / DAY_MS
  if (ageDays >= interval)          return 'needs-review'
  if (ageDays >= interval * 0.75)   return 'review-soon'
  return 'current'
}

/** Public-facing review line, or null when there is nothing honest to show.
 *  'review-soon' is deliberately indistinguishable from 'current' to readers —
 *  it is an editorial signal, not a warning to the public (brief §15). */
export function reviewLabel(
  article: { category: string; lastReviewedAt: Date | string | null; reviewIntervalDays?: number | null },
  now: Date = new Date(),
): { text: string; stale: boolean } | null {
  const state = reviewState(article, now)
  if (state === 'unreviewed') return null
  const when = new Date(article.lastReviewedAt as Date | string)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return { text: `Last reviewed ${when}`, stale: state === 'needs-review' }
}

// Average adult reading speed for practical prose. Rounded up so a 40-second
// article reads "1 min" rather than "0 min".
const WORDS_PER_MINUTE = 220

/** Estimated reading time in minutes from article HTML. Computed rather than
 *  stored so it can never drift out of sync with an edited body. */
export function readingTime(html: string): number {
  const text = html
    .replace(/<[^>]+>/g, ' ')      // strip tags
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')  // strip entities
    .trim()
  if (!text) return 1
  const words = text.split(/\s+/).length
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))
}

export type OfficialSource = { label: string; url: string }

/** Parse the `officialSources` JSON column defensively — it is free-form JSON
 *  in the DB, so a hand-edited row must not be able to crash the article page.
 *  Only https links survive: these are cited as authoritative, and an http one
 *  would be a mixed-content downgrade on a page members are told to trust. */
export function parseOfficialSources(raw: unknown): OfficialSource[] {
  if (!Array.isArray(raw)) return []
  const out: OfficialSource[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { label, url } = item as Record<string, unknown>
    if (typeof label !== 'string' || typeof url !== 'string') continue
    const trimmed = url.trim()
    if (!/^https:\/\//i.test(trimmed)) continue
    const text = label.trim()
    if (!text) continue
    out.push({ label: text, url: trimmed })
  }
  return out
}
