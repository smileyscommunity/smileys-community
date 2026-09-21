import { resolveImageUrl } from './data'
import { categoryHero } from './handbook-categories'
import { isArticleImageSrc } from './uploadedImageUrl'

// The best available preview image for an article, so authors rarely need to
// set the separate cover field: most paste a hero photo at the top of the body
// via the rich-text editor. Priority: explicit coverImage → first inline <img>
// in the body → category banner. Returns null only when none exist.
const FIRST_BODY_IMG_RE = /<img\b[^>]*\bsrc=["']([^"']+)["']/i

// Raw first inline image src from an article body (unresolved), or null.
// Our own uploads only: this reads the UNsanitised body, and the list cards
// and dashboard shelves render what it returns as <img src> for every
// visitor — an external src here was the tracking pixel the article page
// strips, fetched from the index instead.
export function firstBodyImage(body: string): string | null {
  const src = body.match(FIRST_BODY_IMG_RE)?.[1] ?? null
  return src && isArticleImageSrc(src) ? src : null
}

// Resolved preview image URL for listing/card surfaces. Pass `category` to get
// the category-banner fallback; omit it to stop at cover-or-inline (null).
export function articleCover(a: { coverImage: string | null; body: string; category?: string | null }): string | null {
  const raw = a.coverImage ?? firstBodyImage(a.body)
  if (raw) return resolveImageUrl(raw)
  return a.category ? (categoryHero(a.category)?.src ?? null) : null
}
