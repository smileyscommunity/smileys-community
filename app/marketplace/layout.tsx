import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_URL } from '@/lib/env'
import { resolveCityForPage } from '@/lib/cityPageParam'

// Marketplace split out of /board as its own destination. The index page is
// a client component, so metadata lives here — same pattern as /board.
const MARKET_OG_IMAGE = `${APP_URL}/images/board-cover.jpg`
// Same constraint as /board's layout: no searchParams here and a client page,
// so this follows the viewer's city and a cookie-less crawler still gets the
// default one. The og:title named Istanbul outright, which was wrong for every
// other city even for a viewer we CAN identify.
export async function generateMetadata(): Promise<Metadata> {
  const { city } = await resolveCityForPage(undefined)
  const desc     = `Rooms, jobs, services, buy & sell and more — member-to-member listings from the Smileys community in ${city.name}.`
  const ogTitle  = `Smileys Marketplace — ${city.name}`
  return {
    alternates: { canonical: `${APP_URL}/marketplace` },
    title: 'Marketplace — Smileys Community',
    description: desc,
    openGraph: {
      title: ogTitle,
      description: desc,
      url: `${APP_URL}/marketplace`,
      siteName: 'Smileys Community',
      type: 'website',
      images: [{ url: MARKET_OG_IMAGE, secureUrl: MARKET_OG_IMAGE, width: 1200, height: 800, alt: 'Smileys Marketplace' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: desc,
      images: [MARKET_OG_IMAGE],
    },
  }
}

export default function MarketplaceLayout({ children }: { children: ReactNode }) {
  return children
}
