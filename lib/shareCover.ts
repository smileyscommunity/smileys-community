// Which picture a city-scoped public page shares.
//
// Each such page (the Handbook, the Directory) has a fixed-size cover in
// public/images — and each cover is the DEFAULT city's, so every other city
// used to share it too, under its own name. A city gets its own picture by
// one of two routes, in this order:
//
//   public/images/<kind>-cover-<city slug>.jpg   a cover made for the city
//   the city's hero photo from /admin/cities     the honest fallback
//
// Only the default city falls back to the bare cover (DEFAULT_COVER). Covers are
// 1200×800 JPEGs and must stay under the ~300KB at which WhatsApp silently
// drops an og:image (tests/shareCover.test.ts checks every one); a hero photo
// goes through absoluteOgImage, which caps it at 1200px wide for the same
// reason. Dimensions are asserted only for a cover, whose 1200×800 is known —
// a photo has its own aspect and a wrong hint mis-crops the first scrape.

import { existsSync } from 'fs'
import { join } from 'path'
import { APP_URL } from './env'
import { DEFAULT_CITY_SLUG } from './city'
import { absoluteOgImage } from './og'

export type ShareCoverKind = 'handbook' | 'directory' | 'marketplace' | 'board' | 'events' | 'clubs'

// The bare cover per kind, with its dimensions. The marketplace split out of
// /board and kept its picture, so both share one bare cover; the events and
// clubs cards are square by design (they double as the Instagram assets).
// Per-city covers follow the <kind>-cover-<slug>.jpg rule at 1200×800, so
// each surface can have its own.
const DEFAULT_COVER: Record<ShareCoverKind, { file: string; width: number; height: number }> = {
  handbook:    { file: 'handbook-cover.jpg',  width: 1200, height: 800 },
  directory:   { file: 'directory-cover.jpg', width: 1200, height: 800 },
  marketplace: { file: 'board-cover.jpg',     width: 1200, height: 800 },
  board:       { file: 'board-cover.jpg',     width: 1200, height: 800 },
  events:      { file: 'events-og.jpg',       width: 1200, height: 1200 },
  clubs:       { file: 'clubs-og.jpg',        width: 1200, height: 1200 },
}

export interface ShareImage {
  url: string
  secureUrl: string
  alt: string
  width?: number
  height?: number
  // A square card renders uncropped as a 'summary' twitter card, where
  // 'summary_large_image' would letterbox it; anything else wants the
  // large card.
  twitterCard: 'summary' | 'summary_large_image'
}

const coverExists = (file: string) => existsSync(join(process.cwd(), 'public', 'images', file))

export function shareCover(
  kind: ShareCoverKind,
  city: { slug: string; heroImage: string | null | undefined },
  alt: string,
  exists: (file: string) => boolean = coverExists,
): ShareImage {
  const bare  = DEFAULT_COVER[kind]
  const own   = `${kind}-cover-${city.slug}.jpg`
  if (exists(own)) {
    const url = `${APP_URL}/images/${own}`
    return { url, secureUrl: url, width: 1200, height: 800, alt, twitterCard: 'summary_large_image' }
  }
  if (city.slug !== DEFAULT_CITY_SLUG) {
    const photo = absoluteOgImage(city.heroImage)
    if (photo) return { url: photo, secureUrl: photo, alt, twitterCard: 'summary_large_image' }
  }
  // The default city's cover — and, for a city with neither cover nor photo,
  // still better than no picture.
  const url = `${APP_URL}/images/${bare.file}`
  return { url, secureUrl: url, width: bare.width, height: bare.height, alt, twitterCard: bare.width === bare.height ? 'summary' : 'summary_large_image' }
}
