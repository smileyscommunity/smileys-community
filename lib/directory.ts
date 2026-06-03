/**
 * Shared constants + lightweight validation for the business directory.
 *
 * Single source of truth for:
 *   - category enum (used by the public submit form, the public filter
 *     pills, and the server-side POST validator)
 *   - input length caps (per field)
 *   - Instagram handle normalization
 *
 * Anywhere the directory accepts user-supplied text, route the value
 * through these helpers — the page-level imports keep the UI in sync
 * with the server's allowlist automatically.
 */

export const BUSINESS_CATEGORIES = [
  'Restaurant',
  'Cafe',
  'Bar',
  'Shop',
  'Services',
  'Fitness',
  'Beauty',
  'Health',
  'Education',
  'Other',
] as const

export type BusinessCategory = typeof BUSINESS_CATEGORIES[number]

export const BUSINESS_CATEGORY_SET: ReadonlySet<string> = new Set(BUSINESS_CATEGORIES)

// Per-field length caps. The DB column types are unbounded TEXT, so
// these are the only thing preventing a multi-MB description from
// being stored and shipped to every directory grid render.
export const DIRECTORY_LIMITS = {
  name:         120,
  description:  1000,
  neighborhood: 80,
  address:      200,
  phone:        40,
  website:      500,
  instagram:    60,
  languages:    200,
  // Logos/covers are URLs, not images — uploads go through a separate
  // pipeline. 500 is plenty for any reasonable CDN URL.
  logo:         500,
  coverImage:   500,
} as const

/**
 * Normalize an Instagram handle to bare-handle form. Strips leading `@`,
 * any URL prefix (https://instagram.com/foo or instagram.com/foo →
 * foo), and rejects anything outside the handle charset so the value
 * can't break out of `https://instagram.com/${handle}` interpolation.
 *
 * Returns `null` if the input doesn't yield a valid handle.
 */
export function normalizeInstagramHandle(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  // Strip protocol + host so admins/users can paste full URLs.
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
  s = s.replace(/^@/, '')
  // Strip any trailing slash or query string from a URL paste.
  s = s.split(/[/?#]/)[0]
  // Instagram handles: 1–30 chars, letters/digits/underscore/dot.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null
  return s
}
