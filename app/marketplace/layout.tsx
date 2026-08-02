import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_URL } from '@/lib/env'

// Marketplace split out of /board as its own destination. The index page is
// a client component, so metadata lives here — same pattern as /board.
const MARKET_OG_IMAGE = `${APP_URL}/images/board-cover.jpg`
const MARKET_DESC     = 'Rooms, jobs, services, buy & sell and more — member-to-member listings from the Smileys community in Istanbul.'

export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/marketplace` },
  title: 'Marketplace — Smileys Community',
  description: MARKET_DESC,
  openGraph: {
    title: 'Smileys Marketplace — Istanbul',
    description: MARKET_DESC,
    url: `${APP_URL}/marketplace`,
    siteName: 'Smileys Community',
    type: 'website',
    images: [{ url: MARKET_OG_IMAGE, secureUrl: MARKET_OG_IMAGE, width: 1200, height: 800, alt: 'Smileys Marketplace' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Smileys Marketplace — Istanbul',
    description: MARKET_DESC,
    images: [MARKET_OG_IMAGE],
  },
}

export default function MarketplaceLayout({ children }: { children: ReactNode }) {
  return children
}
