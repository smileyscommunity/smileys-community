import type { Metadata } from 'next'
import { APP_URL } from '@/lib/env'

// See app/about/page.tsx — a page-level `openGraph` block loses the root
// layout's default og:image, so this shared with no preview at all on
// WhatsApp/iMessage/Twitter until this was added.
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Istanbul City Guide',
  eyebrow: 'Smileys Community',
  cta:     'Read the guide',
}).toString()}`

export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/guide` },
  title: 'Istanbul City Guide — Smileys Community',
  description: 'Practical, admin-curated guide for expats in Istanbul. Transit tips, essential apps, neighborhood guides, and local know-how.',
  openGraph: {
    title: 'Istanbul City Guide — Smileys Community',
    description: 'Ferries, metro lines, neighborhoods, apps and practical tips — everything you need to navigate Istanbul as an expat.',
    url: `${APP_URL}/guide`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Istanbul City Guide — Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Istanbul City Guide — Smileys Community',
    description: 'Ferries, metro lines, neighborhoods, apps and practical tips — everything you need to navigate Istanbul as an expat.',
    images: [ogImage],
  },
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
