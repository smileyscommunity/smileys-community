import type { Metadata } from 'next'
import { APP_URL } from '@/lib/env'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig } from '@/lib/city'
import { absoluteOgImage } from '@/lib/og'

// See app/about/page.tsx — a page-level `openGraph` block loses the root
// layout's default og:image, so this shared with no preview at all on
// WhatsApp/iMessage/Twitter until this was added. The branded share card
// (baked title — fine for social cards; the page hero keeps text in HTML per
// the design brief) is pre-resized to 1200x640 ~204KB, under WhatsApp's ~300KB
// silent-drop threshold.
const ogImage = `${APP_URL}/images/guide-og.jpg`

// Titles and description follow the city being viewed. They were fixed strings
// naming Istanbul, so Bodrum's guide shared as "Istanbul City Guide" with an
// Istanbul card — the same leak the neighborhoods page had. A city with its own
// photo shares that; everyone else keeps the branded card, whose baked title
// says Istanbul, so it is only used for the default city.
export async function generateMetadata(): Promise<Metadata> {
  const city = await getCityConfig(await resolveCityId(await getSession()))
  const title = `${city.name} City Guide — Smileys Community`
  const description = `Experience ${city.name} like you know someone here — things worth doing, recommended by people who actually live here.`
  const cityOg = absoluteOgImage(city.heroImage)
  const image = cityOg
    ? { url: cityOg, alt: `${city.name} Guide — Smileys Community` }
    : { url: ogImage, width: 1200, height: 640, alt: 'Smileys Guide — Experience the city. Live the stories.' }

  return {
    alternates: { canonical: `${APP_URL}/guide` },
    title,
    description,
    openGraph: { title, description, url: `${APP_URL}/guide`, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  }
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
