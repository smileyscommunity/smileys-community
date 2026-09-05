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

export type ShareCoverKind = 'handbook' | 'directory' | 'marketplace' | 'board'

// The bare cover per kind. The marketplace split out of /board and kept its
// picture, so both share one bare cover; per-city covers still follow the
// <kind>-cover-<slug>.jpg rule, so each can have its own.
const DEFAULT_COVER: Record<ShareCoverKind, string> = {
  handbook:    'handbook-cover.jpg',
  directory:   'directory-cover.jpg',
  marketplace: 'board-cover.jpg',
  board:       'board-cover.jpg',
}

export interface ShareImage {
  url: string
  secureUrl: string
  alt: string
  width?: number
  height?: number
}

const coverExists = (file: string) => existsSync(join(process.cwd(), 'public', 'images', file))

export function shareCover(
  kind: ShareCoverKind,
  city: { slug: string; heroImage: string | null | undefined },
  alt: string,
  exists: (file: string) => boolean = coverExists,
): ShareImage {
  const own   = `${kind}-cover-${city.slug}.jpg`
  const cover = exists(own)                      ? `${APP_URL}/images/${own}`
              : city.slug === DEFAULT_CITY_SLUG ? `${APP_URL}/images/${DEFAULT_COVER[kind]}`
              : null
  if (cover) return { url: cover, secureUrl: cover, width: 1200, height: 800, alt }

  const photo = absoluteOgImage(city.heroImage)
  if (photo) return { url: photo, secureUrl: photo, alt }

  // No cover and no photo: the default cover is still better than no picture.
  const fallback = `${APP_URL}/images/${DEFAULT_COVER[kind]}`
  return { url: fallback, secureUrl: fallback, width: 1200, height: 800, alt }
}
