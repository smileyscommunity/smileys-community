import Image from 'next/image'
import { existsSync } from 'fs'
import { join } from 'path'
import { resolveImageUrl } from '@/lib/data'

// The full-bleed photo hero the Visiting page uses, for the city hubs beside
// it (Moving, Remote work). The photo is, in order:
//
//   public/images/<kind>-hero-<city slug>.jpg   a photo made for this page
//   the city's hero photo from /admin/cities     every city has one
//
// Per city, like the share covers in lib/shareCover.ts: a photo of Istanbul
// on Izmir's page would be a false picture of the place. With neither, the
// section falls back to a plain dark background rather than a broken image —
// the copy is white and needs something dark behind it either way.

export type PhotoHeroKind = 'moving' | 'remote-work'

// The outlined second button over the photo — btn-secondary is a white card
// meant for a light page.
export const HERO_SECONDARY = 'inline-flex items-center justify-center gap-2 px-8 py-4 border border-white/50 hover:bg-white/10 text-white text-base font-semibold rounded-xl transition-colors backdrop-blur-sm'

export default function PhotoHero({
  kind,
  city,
  alt,
  children,
}: {
  kind: PhotoHeroKind
  city: { slug: string; name: string; heroImage: string | null | undefined }
  // Describes the page's own photo; the city photo gets a generic one, since
  // nothing here knows what it shows.
  alt: string
  children: React.ReactNode
}) {
  const own = `${kind}-hero-${city.slug}.jpg`
  const photo = existsSync(join(process.cwd(), 'public', 'images', own))
    ? { src: `/app/images/${own}`, alt }
    : city.heroImage
      ? { src: resolveImageUrl(city.heroImage), alt: `Smileys members in ${city.name}` }
      : null

  return (
    // min-height, not a fixed height: the headline wraps to four lines on a
    // phone, and a fixed box clips the top (the Visiting hero's lesson).
    <section className="relative min-h-[500px] sm:min-h-[560px] w-full overflow-hidden flex items-center bg-gray-900">
      {photo && (
        <Image src={photo.src} alt={photo.alt} fill priority fetchPriority="high" sizes="100vw" className="object-cover object-center" />
      )}
      {/* Same gradient as Visiting: white text over a bright sky drops below
          AA without it. */}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/30" />
      <div className="relative w-full py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="max-w-2xl">{children}</div>
        </div>
      </div>
    </section>
  )
}
