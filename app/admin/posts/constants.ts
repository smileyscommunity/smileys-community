// Shared by the admin posts list page, the PostForm, and the API
// routes. Mirroring the same array in three places (and having one of
// them drift) was a real risk — the API didn't validate category at
// all, so an admin could write any string. Now this single allowlist
// is the source of truth.

import { CATEGORY_KEYS, canonicalCategory } from '@/lib/handbook-categories'

export const KINDS = ['community', 'handbook'] as const
export type Kind = (typeof KINDS)[number]
export function isKind(s: unknown): s is Kind {
  return typeof s === 'string' && (KINDS as readonly string[]).includes(s)
}

export const CATEGORIES = ['Community', 'Club Stories', 'Events', 'Istanbul Guide', 'Tips'] as const
export type Category = (typeof CATEGORIES)[number]
export function isCategory(s: unknown): s is Category {
  return typeof s === 'string' && (CATEGORIES as readonly string[]).includes(s)
}

// Handbook categories are the 10-category IA in lib/handbook-categories — the
// single source of truth, imported rather than re-listed so the admin form and
// the public pages can't drift apart. (lib/handbook-categories is pure data
// with no server-only imports, so the client PostForm can import it too.)
export const HANDBOOK_CATEGORIES = CATEGORY_KEYS as readonly string[]

// Writes accept legacy keys as well as canonical ones, then normalise. Without
// this, saving an article still stored under 'Bureaucracy' would fail the
// allowlist and get silently reset to the default category — a real data-loss
// path, since the inline article editor round-trips category on every save.
export function isHandbookCategory(s: unknown): boolean {
  return typeof s === 'string' && canonicalCategory(s) !== null
}

/** The value to persist for a submitted category: canonical when it resolves,
 *  so editing a legacy article quietly migrates it onto the new IA. */
export function normalizeHandbookCategory(s: unknown): string {
  return (typeof s === 'string' ? canonicalCategory(s) : null) ?? HANDBOOK_CATEGORIES[0]
}

export function isValidCategory(kind: string, cat: unknown): boolean {
  return kind === 'handbook' ? isHandbookCategory(cat) : isCategory(cat)
}

// Soft caps mirrored client+server. The actual writes trim and re-cap
// server-side; these are the soft thresholds for the inline counter
// + the validation a contributor would copy when adding a new field.
export const TITLE_MAX   = 200
export const EXCERPT_MAX = 500
export const BODY_MAX    = 50_000
