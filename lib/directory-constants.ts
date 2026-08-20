// Pure constants and utilities for the business directory.
// Client components must import from this file, not lib/directory.ts,
// because lib/directory.ts imports Prisma (Node-only) for its query helpers.

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
  logo:         500,
  coverImage:   500,
  memberDiscount: 80,
} as const

// Tag normalization: trim, collapse internal whitespace, drop empties,
// dedupe (case-insensitive on the comparison, original case preserved
// on the survivor), cap each tag to 30 chars and the array to 12 tags.
const TAG_MAX = 30
const TAGS_MAX_PER_BIZ = 12

export function normalizeTags(input: unknown): string[] | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'string') {
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

export function parseGoogleMapsUrl(input: string): { lat: number; lon: number } | null {
  if (!input || typeof input !== 'string') return null
  const url = input.trim()
  if (!url) return null

  const patterns: RegExp[] = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (!m) continue
    const lat = parseFloat(m[1])
    const lon = parseFloat(m[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (lat < -90  || lat > 90)  continue
    if (lon < -180 || lon > 180) continue
    return { lat, lon }
  }

  return null
}

export function attributionDisplay(fullName: string | null | undefined): string {
  if (!fullName || typeof fullName !== 'string') return 'a member'
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'a member'
  if (parts.length === 1) return parts[0]
  const first = parts[0]
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? ''
  return lastInitial ? `${first} ${lastInitial}.` : first
}

export function normalizeInstagramHandle(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
  s = s.replace(/^@/, '')
  s = s.split(/[/?#]/)[0]
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null
  return s
}
