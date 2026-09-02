import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_URL } from '@/lib/env'
import { resolveCityForPage } from '@/lib/cityPageParam'
import { DEFAULT_CITY_SLUG } from '@/lib/city'

// The /board index page is a client component and can't export metadata, so
// its title/description/canonical live here. Canonical is safe: board/[id]
// sets its own, which overrides this for detail pages.
// Fixed-size cover (1200×800) served from public/ under the /app basePath.
const BOARD_OG_IMAGE = `${APP_URL}/images/board-cover.jpg`
// Layouts get no searchParams, and /board's page is a client component that
// can't export metadata — so unlike /neighborhoods this can't carry ?city= and
// falls back to the viewer's city. That fixes the share text for members and
// anyone holding a view-city cookie; a link-preview crawler has neither, so it
// still sees the default city. Naming a city that cannot be known from the URL
// is the limit here, not an oversight.
export async function generateMetadata(): Promise<Metadata> {
  const { city } = await resolveCityForPage(undefined)
  const desc  = `Plans, questions and recommendations from the Smileys community in ${city.name} — ask, share, connect.`
  const title = 'Community Board — Smileys Community'
  return {
    // Same rule as app/events/layout.tsx: another city's board is canonical
    // at its hub (/[city]/board); the default city's stays here.
    alternates: { canonical: city.slug === DEFAULT_CITY_SLUG ? `${APP_URL}/board` : `${APP_URL}/${city.slug}/board` },
    title,
    description: desc,
    openGraph: {
      title, description: desc,
      url: `${APP_URL}/board`,
      siteName: 'Smileys Community',
      type: 'website',
      images: [{ url: BOARD_OG_IMAGE, secureUrl: BOARD_OG_IMAGE, width: 1200, height: 800, alt: 'Community Board — Smileys Community' }],
    },
    twitter: {
      card: 'summary_large_image',
      title, description: desc,
      images: [BOARD_OG_IMAGE],
    },
  }
}

export default function ListingsLayout({ children }: { children: ReactNode }) {
  return children
}
