// Which picture a city-scoped public page shares.
//
// Each such page (the Handbook, the Directory, the Board and Marketplace,
// Events, Clubs, Neighborhoods, the Guide, Visiting) once shared one fixed picture — and it was the default
// city's, so every other city shared it too, under its own name. The rule
// is now the same for every city, the default included:
//
//   public/images/<kind>-cover-<city slug>.jpg   a cover made for the city
//   the city's hero photo from /admin/cities     the honest default
//   the kind's brand card                        only when a city has neither
//
// Istanbul's purpose-made covers ("Istanbul Handbook", "Istanbul Directory",
// "Istanbul Board", "Istanbul Neighbourhoods") are its per-city files; where it has none it shares its
// hero photo like everyone else. Covers must stay under the ~300KB at which
// WhatsApp silently drops an og:image (tests/shareCover.test.ts checks every
// one); a hero photo goes through absoluteOgImage, which caps it at 1200px
// wide for the same reason. Dimensions are asserted only for a brand card,
// whose size is known — a cover or photo has its own aspect and a wrong hint
// mis-crops the first scrape.

import { existsSync } from 'fs'
import { join } from 'path'
import { APP_URL } from './env'
import { absoluteOgImage } from './og'

export type ShareCoverKind = 'handbook' | 'directory' | 'marketplace' | 'board' | 'events' | 'clubs' | 'neighborhoods' | 'guide' | 'visiting'

// The brand card per kind, with its dimensions. The events and clubs cards
// are square by design (they double as the Instagram assets); the rest use
// the generated Smileys card, the same fallback the landing and city pages
// share when they have no photo.
const BRAND_CARD: Record<ShareCoverKind, { url: string; width: number; height: number }> = {
  handbook:    { url: `${APP_URL}/api/og`,              width: 1200, height: 630 },
  directory:   { url: `${APP_URL}/api/og`,              width: 1200, height: 630 },
  marketplace: { url: `${APP_URL}/api/og`,              width: 1200, height: 630 },
  board:       { url: `${APP_URL}/api/og`,              width: 1200, height: 630 },
  neighborhoods: { url: `${APP_URL}/api/og`,            width: 1200, height: 630 },
  events:      { url: `${APP_URL}/images/events-og.jpg`, width: 1200, height: 1200 },
  clubs:       { url: `${APP_URL}/images/clubs-og.jpg`,  width: 1200, height: 1200 },
  // The guide's branded card, and the visiting page's share copy of the hero
  // photo it shows when a city has none (the 456KB original is over the
  // WhatsApp threshold; this copy is pre-resized).
  guide:       { url: `${APP_URL}/images/guide-og.jpg`,        width: 1200, height: 640 },
  visiting:    { url: `${APP_URL}/images/visiting-hero-og.jpg`, width: 1200, height: 800 },
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
  const own = `${kind}-cover-${city.slug}.jpg`
  if (exists(own)) {
    const url = `${APP_URL}/images/${own}`
    return { url, secureUrl: url, alt, twitterCard: 'summary_large_image' }
  }

  const photo = absoluteOgImage(city.heroImage)
  if (photo) return { url: photo, secureUrl: photo, alt, twitterCard: 'summary_large_image' }

  const card = BRAND_CARD[kind]
  return { url: card.url, secureUrl: card.url, width: card.width, height: card.height, alt, twitterCard: card.width === card.height ? 'summary' : 'summary_large_image' }
}
