import { resolveImageUrl } from './data'
import { categoryHero } from './handbook-categories'

// The best available preview image for an article, so authors rarely need to
// set the separate cover field: most paste a hero photo at the top of the body
// via the rich-text editor. Priority: explicit coverImage → first inline <img>
// in the body → category banner. Returns null only when none exist.
const FIRST_BODY_IMG_RE = /<img\b[^>]*\bsrc=["']([^"']+)["']/i

// Raw first inline image src from an article body (unresolved), or null.
export function firstBodyImage(body: string): string | null {
  return body.match(FIRST_BODY_IMG_RE)?.[1] ?? null
}

// Resolved preview image URL for listing/card surfaces. Pass `category` to get
// the category-banner fallback; omit it to stop at cover-or-inline (null).
export function articleCover(a: { coverImage: string | null; body: string; category?: string | null }): string | null {
  const raw = a.coverImage ?? firstBodyImage(a.body)
  if (raw) return resolveImageUrl(raw)
  return a.category ? (categoryHero(a.category)?.src ?? null) : null
}
