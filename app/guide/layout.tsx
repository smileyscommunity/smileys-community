import type { Metadata } from 'next'
import { APP_URL } from '@/lib/env'

// See app/about/page.tsx — a page-level `openGraph` block loses the root
// layout's default og:image, so this shared with no preview at all on
// WhatsApp/iMessage/Twitter until this was added. Uses the branded
// share card (baked title — fine for social cards; the page hero keeps
// text in HTML per the design brief), pre-resized to 1200x640 ~204KB,
// under WhatsApp's ~300KB silent-drop threshold.
const ogImage = `${APP_URL}/images/guide-og.jpg`

export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/guide` },
  title: 'Istanbul City Guide — Smileys Community',
  description: 'Experience Istanbul like you know someone here — things worth doing, recommended by people who actually live in the city.',
  openGraph: {
    title: 'Istanbul City Guide — Smileys Community',
    description: 'Experience Istanbul like you know someone here — things worth doing, recommended by people who actually live in the city.',
    url: `${APP_URL}/guide`,
    images: [{ url: ogImage, width: 1200, height: 640, alt: 'Istanbul Guide — Experience the city. Live the stories.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Istanbul City Guide — Smileys Community',
    description: 'Experience Istanbul like you know someone here — things worth doing, recommended by people who actually live in the city.',
    images: [ogImage],
  },
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
