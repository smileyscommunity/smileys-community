// Shared by the admin posts list page, the PostForm, and the API
// routes. Mirroring the same array in three places (and having one of
// them drift) was a real risk — the API didn't validate category at
// all, so an admin could write any string. Now this single allowlist
// is the source of truth.

export const CATEGORIES = ['Community', 'Club Stories', 'Events', 'Istanbul Guide', 'Tips'] as const
export type Category = (typeof CATEGORIES)[number]

export function isCategory(s: unknown): s is Category {
  return typeof s === 'string' && (CATEGORIES as readonly string[]).includes(s)
}

// Soft caps mirrored client+server. The actual writes trim and re-cap
// server-side; these are the soft thresholds for the inline counter
// + the validation a contributor would copy when adding a new field.
export const TITLE_MAX   = 200
export const EXCERPT_MAX = 500
export const BODY_MAX    = 50_000
