import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_URL } from '@/lib/env'

// The /directory index page is a client component and can't export metadata, so
// its title/description/canonical live here. Canonical is safe: directory/[id]
// sets its own, which overrides this for detail pages.
// Fixed-size cover (1200×800) served from public/ under the /app basePath.
const DIRECTORY_OG_IMAGE = `${APP_URL}/images/directory-cover.jpg`
const DIRECTORY_OG_DESC  = 'Member-recommended businesses, services and places across Istanbul — cafés, doctors, gyms and more, vouched for by the Smileys community.'

export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/directory` },
  title: 'Istanbul Directory — Smileys Community',
  description: DIRECTORY_OG_DESC,
  openGraph: {
    title: 'Istanbul Directory — Smileys Community',
    description: DIRECTORY_OG_DESC,
    url: `${APP_URL}/directory`,
    siteName: 'Smileys Community',
    type: 'website',
    images: [{ url: DIRECTORY_OG_IMAGE, secureUrl: DIRECTORY_OG_IMAGE, width: 1200, height: 800, alt: 'Istanbul Directory — Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Istanbul Directory — Smileys Community',
    description: DIRECTORY_OG_DESC,
    images: [DIRECTORY_OG_IMAGE],
  },
}

export default function DirectoryLayout({ children }: { children: ReactNode }) {
  return children
}
