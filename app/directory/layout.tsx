import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_URL } from '@/lib/env'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig, DEFAULT_CITY_SLUG } from '@/lib/city'

// The /directory index page is a client component and can't export metadata, so
// its title/description/canonical live here. Canonical is safe: directory/[id]
// sets its own, which overrides this for detail pages.
// Fixed-size cover (1200×800) served from public/ under the /app basePath.
const DIRECTORY_OG_IMAGE = `${APP_URL}/images/directory-cover.jpg`

// Names the city whose listings you're actually being shown. GET /api/directory
// scopes its query with resolveCityId, so an Izmir member browsing here sees
// Izmir businesses under a heading that used to read "Istanbul Directory".
//
// The DEFAULT city keeps its exact indexed strings — this page is indexed under
// "Istanbul directory", and rewording a title Google already has costs
// something for nothing. Crawlers carry no cookie, so they resolve to the
// default city and see precisely what they see today.
export async function generateMetadata(): Promise<Metadata> {
  const cfg  = await getCityConfig(await resolveCityId(await getSession()))
  const name = cfg.name
  const title = `${name} Directory — Smileys Community`
  const desc  = cfg.slug === DEFAULT_CITY_SLUG
    ? 'Member-recommended businesses, services and places across Istanbul — cafés, doctors, gyms and more, vouched for by the Smileys community.'
    : `Member-recommended businesses, services and places across ${name} — cafés, doctors, gyms and more, vouched for by the Smileys community.`

  return {
    // Same rule as app/events/layout.tsx: another city's directory is
    // canonical at its hub (/[city]/directory); the default city's stays here.
    alternates: { canonical: cfg.slug === DEFAULT_CITY_SLUG ? `${APP_URL}/directory` : `${APP_URL}/${cfg.slug}/directory` },
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      url: `${APP_URL}/directory`,
      siteName: 'Smileys Community',
      type: 'website',
      images: [{ url: DIRECTORY_OG_IMAGE, secureUrl: DIRECTORY_OG_IMAGE, width: 1200, height: 800, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: desc,
      images: [DIRECTORY_OG_IMAGE],
    },
  }
}

export default function DirectoryLayout({ children }: { children: ReactNode }) {
  return children
}
