import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_URL } from '@/lib/env'

// The /board index page is a client component and can't export metadata, so
// its title/description/canonical live here. Canonical is safe: board/[id]
// sets its own, which overrides this for detail pages.
// Fixed-size cover (1200×800) served from public/ under the /app basePath.
const BOARD_OG_IMAGE = `${APP_URL}/images/board-cover.jpg`
const BOARD_DESC     = 'Rooms, jobs, services, buy & sell and more — the Smileys community board for Istanbul.'

export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/board` },
  title: 'Community Board — Smileys Community',
  description: BOARD_DESC,
  openGraph: {
    title: 'Community Board — Smileys Community',
    description: BOARD_DESC,
    url: `${APP_URL}/board`,
    siteName: 'Smileys Community',
    type: 'website',
    images: [{ url: BOARD_OG_IMAGE, secureUrl: BOARD_OG_IMAGE, width: 1200, height: 800, alt: 'Community Board — Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Community Board — Smileys Community',
    description: BOARD_DESC,
    images: [BOARD_OG_IMAGE],
  },
}

export default function ListingsLayout({ children }: { children: ReactNode }) {
  return children
}
