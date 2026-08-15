// Absolute, size-capped image URLs for social previews.
//
// Two things every OG image here needs and a relative path can't give:
// an absolute URL (crawlers don't resolve relative ones) and a bounded file
// size. ?w=1200 hits the file route's PREVIEW resize — aspect-preserved JPEG —
// which keeps previews under the ~600 KB that WhatsApp, iMessage and X silently
// drop. Upload originals are routinely several times that.

import { SITE_URL } from './env'
import { resolveImageUrl } from './data'

export function absoluteOgImage(photo: string | null | undefined): string | undefined {
  if (!photo) return undefined
  const resolved = resolveImageUrl(photo)
  return resolved.startsWith('http') ? resolved : `${SITE_URL}${resolved}?w=1200`
}
