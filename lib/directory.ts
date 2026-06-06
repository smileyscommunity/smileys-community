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
  // Short marketing line like "10% off for Smileys members". Capped
  // tightly so it doesn't compete visually with the business name.
  memberDiscount: 80,
} as const

// Tag normalization: trim, collapse internal whitespace, drop empties,
// dedupe (case-insensitive on the comparison, original case preserved
// on the survivor), cap each tag to 30 chars and the array to 12 tags.
// Used by both admin create + admin/owner PATCH.
const TAG_MAX = 30
const TAGS_MAX_PER_BIZ = 12

export function normalizeTags(input: unknown): string[] | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'string') {
    // Allow comma-separated input from the admin form.
    return normalizeTags(input.split(','))
  }
  if (!Array.isArray(input)) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, TAG_MAX)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
    if (out.length >= TAGS_MAX_PER_BIZ) break
  }
  return out
}

/**
 * Parse latitude + longitude out of a Google Maps URL. Supports the
 * common shapes admins paste from desktop Maps:
 *
 *   https://www.google.com/maps/place/Name/@41.0345,28.9817,17z/data=...
 *   https://www.google.com/maps/@41.0345,28.9817,17z
 *   https://maps.google.com/?q=41.0345,28.9817
 *   https://maps.google.com/?ll=41.0345,28.9817
 *   https://www.google.com/maps?q=41.0345,28.9817
 *
 * Mobile share short links (`maps.app.goo.gl/...`, `goo.gl/maps/...`)
 * can't be resolved without an HTTP fetch — caller gets `null` and
 * should show a "use the desktop URL" hint.
 *
 * Returns null when no coordinate pattern matches.
 */
export function parseGoogleMapsUrl(input: string): { lat: number; lon: number } | null {
  if (!input || typeof input !== 'string') return null
  const url = input.trim()
  if (!url) return null

  // Try each known coord pattern; return the first one whose values land
  // inside the valid global ranges. A regex-pure match like @99,200 used
  // to pass through and trigger a misleading "Coords filled" toast,
  // followed by a 400 from the server-side parseCoord check.
  const patterns: RegExp[] = [
    // @lat,lng — most common shape from desktop "Share / Embed map".
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    // ?q=lat,lng or &q=lat,lng (older "What's here?" copy-paste shape).
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
    // ?ll=lat,lng (alternate query param used by some Maps share variants).
    /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (!m) continue
    const lat = parseFloat(m[1])
    const lon = parseFloat(m[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    // Global range bounds — same constraint the server-side parseCoord
    // applies, so what the UI says is fillable will actually save.
    if (lat < -90  || lat > 90)  continue
    if (lon < -180 || lon > 180) continue
    return { lat, lon }
  }

  return null
}

/**
 * Public-safe attribution display name for a directory submission.
 * "Sarah Karaman" → "Sarah K." — drops the last name to the initial
 * so the directory's "Added by …" line doesn't leak the full surname
 * of every submitter to scrapers. Falls back to the bare first name
 * when the user only has a single token.
 */
export function attributionDisplay(fullName: string | null | undefined): string {
  if (!fullName || typeof fullName !== 'string') return 'a member'
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'a member'
  if (parts.length === 1) return parts[0]
  const first = parts[0]
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? ''
  return lastInitial ? `${first} ${lastInitial}.` : first
}

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
