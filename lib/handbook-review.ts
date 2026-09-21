// Handbook article freshness: reading time, review state, and official sources.
//
// The governing rule (brief §14): never show a review date that nobody earned.
// `updatedAt` is not a review — it moves on typo fixes and bulk migrations —
// so an article with no `lastReviewedAt` reads as "not yet reviewed" and shows
// no date at all. That honesty is the whole point of the field: a Handbook
// that lies about its freshness is worse than one that admits it's unsure.

import { DEFAULT_TZ } from './cityTime'
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
  // A review stamped at 00:30 Istanbul rendered as the previous day on a
  // UTC server. Reviews are a staff act, so the default city's calendar.
  const when = new Date(article.lastReviewedAt as Date | string)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: DEFAULT_TZ })
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

export type OfficialSource = { label: string; url: string; host: string }

export const SOURCE_LABEL_MAX = 120
export const SOURCE_URL_MAX   = 2048
export const SOURCES_MAX      = 30

/** Parse the `officialSources` JSON column defensively — it is free-form JSON
 *  in the DB, so a hand-edited row must not be able to crash the article page.
 *  Only https links that actually parse survive: these are cited as
 *  authoritative, an http one would be a mixed-content downgrade on a page
 *  members are told to trust, and `"https://"` alone passed the old prefix
 *  check and then threw inside `new URL()` in the render — a 500 for the
 *  whole article. The hostname is computed here, once, for the same reason. */
export function parseOfficialSources(raw: unknown): OfficialSource[] {
  if (!Array.isArray(raw)) return []
  const out: OfficialSource[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { label, url } = item as Record<string, unknown>
    if (typeof label !== 'string' || typeof url !== 'string') continue
    const trimmed = url.trim()
    let parsed: URL
    try { parsed = new URL(trimmed) } catch { continue }
    if (parsed.protocol !== 'https:' || !parsed.hostname) continue
    const text = label.trim().slice(0, SOURCE_LABEL_MAX)
    if (!text) continue
    // One row per link: the same URL twice is a duplicate React key on the
    // article, which breaks hydration for the whole page.
    if (out.some(s => s.url === trimmed)) continue
    out.push({ label: text, url: trimmed, host: parsed.hostname.replace(/^www\./, '') })
    if (out.length >= SOURCES_MAX) break
  }
  return out
}

/** The same check the admin form's rows get on write: a clear reason, or null. */
export function officialSourceError(item: unknown): string | null {
  if (!item || typeof item !== 'object') return 'Each source needs a label and an https link'
  const { label, url } = item as Record<string, unknown>
  if (typeof label !== 'string' || !label.trim()) return 'Each source needs a label'
  if (label.trim().length > SOURCE_LABEL_MAX) return `Source labels are ${SOURCE_LABEL_MAX} characters at most`
  if (typeof url !== 'string' || !url.trim()) return `"${label.trim()}" needs a link`
  if (url.trim().length > SOURCE_URL_MAX) return `"${label.trim()}" has a link that is too long`
  let parsed: URL
  try { parsed = new URL(url.trim()) } catch { return `"${label.trim()}" has a link that is not a valid address` }
  if (parsed.protocol !== 'https:') return `"${label.trim()}" has to link to an https:// page`
  return null
}

// How many sources the article page shows before folding the rest. Bodrum's
// article cites 31 — a reader who wants "the authority that sets this rule"
// should not have to scan a bibliography to find it.
export const SOURCES_SHOWN = 6

export const TAGS_MAX     = 10
export const TAG_LEN_MAX  = 40
export const REVIEW_INTERVAL_MIN = 1
export const REVIEW_INTERVAL_MAX = 730

/** Normalise a tags payload from the admin form; null = invalid. */
export function normalizeTags(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  for (const t of raw) {
    if (typeof t !== 'string') return null
    const v = t.trim()
    if (!v) continue
    if (v.length > TAG_LEN_MAX) return null
    // The admin form round-trips tags as one comma-separated field, so a tag
    // containing a comma would come back as two.
    if (v.includes(',')) return null
    seen.add(v)
  }
  if (seen.size > TAGS_MAX) return null
  return [...seen]
}

// ── Admin-form fields ───────────────────────────────────────────────────────
// The review lifecycle had no staff path at all: none of these columns was in
// the form or read by the API, so "Last reviewed" could only move via a
// server script — 12 of 16 articles said "Not yet reviewed" because nobody
// who reviews could say otherwise. `lastReviewedAt` is deliberately NOT here:
// it is set by the "Reviewed today" action alone, after a real check.
export type HandbookFieldsPatch = {
  reviewIntervalDays?: number | null
  tags?:               string[]
  officialSources?:    { label: string; url: string }[]
}

/** Validate the handbook fields of an admin write. Keys absent from `input`
 *  are absent from the patch (a partial edit leaves them alone). */
export function parseHandbookFields(input: unknown):
  { ok: true; data: HandbookFieldsPatch } | { ok: false; error: string } {
  const data: HandbookFieldsPatch = {}
  // A body that isn't an object carries no fields to patch; the caller's own
  // title/body validation is what answers it.
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: true, data }
  if ('reviewIntervalDays' in input) {
    const v = (input as Record<string, unknown>).reviewIntervalDays
    if (v === null || v === '' || v === undefined) data.reviewIntervalDays = null
    else {
      if (typeof v !== 'number' && typeof v !== 'string') {
        return { ok: false, error: `Review interval has to be a whole number of days between ${REVIEW_INTERVAL_MIN} and ${REVIEW_INTERVAL_MAX}` }
      }
      const n = Number(v)
      if (!Number.isInteger(n) || n < REVIEW_INTERVAL_MIN || n > REVIEW_INTERVAL_MAX) {
        return { ok: false, error: `Review interval has to be a whole number of days between ${REVIEW_INTERVAL_MIN} and ${REVIEW_INTERVAL_MAX}` }
      }
      data.reviewIntervalDays = n
    }
  }
  if ('tags' in input) {
    const tags = normalizeTags((input as Record<string, unknown>).tags)
    if (!tags) return { ok: false, error: `Up to ${TAGS_MAX} tags, each ${TAG_LEN_MAX} characters at most` }
    data.tags = tags
  }
  if ('officialSources' in input) {
    const raw = (input as Record<string, unknown>).officialSources
    if (raw === null || raw === undefined) data.officialSources = []
    else {
      if (!Array.isArray(raw)) return { ok: false, error: 'Sources have to be a list' }
      if (raw.length > SOURCES_MAX) return { ok: false, error: `Up to ${SOURCES_MAX} sources` }
      const out: { label: string; url: string }[] = []
      for (const item of raw) {
        const err = officialSourceError(item)
        if (err) return { ok: false, error: err }
        const { label, url } = item as { label: string; url: string }
        // Same link twice is one source (a duplicate React key on the page).
        if (out.some(s => s.url === url.trim())) continue
        out.push({ label: label.trim(), url: url.trim() })
      }
      data.officialSources = out
    }
  }
  return { ok: true, data }
}
