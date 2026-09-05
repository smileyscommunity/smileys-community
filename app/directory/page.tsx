import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { APP_URL } from '@/lib/env'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveCityForPage } from '@/lib/cityPageParam'
import { shareCover } from '@/lib/shareCover'
import ExploreMore from '@/components/ExploreMore'
import DirectoryClient from './DirectoryClient'

// Server wrapper around the client-side directory browser (./DirectoryClient,
// renamed from this file). It resolves the city, owns the page's metadata
// (the client tree can't export any) and appends the shared ExploreMore
// cross-link grid, which needs the DB and so can't live inside the client.
//
// Which city: ?city= when the URL carries one, else the view-city cookie →
// member's home city → default (lib/cityPageParam). A link-preview crawler
// has neither session nor cookie, so without the param every share of
// /directory previewed as the default city's — name and cover — whatever
// city the sharer had on screen. The client passes the same ?city= to
// GET /api/directory and /api/city/current, so listings, heading and this
// metadata agree.

type Search = Record<string, string | string[] | undefined>
interface Props { searchParams?: Promise<Search> }

// Names the city whose listings you're actually being shown. The DEFAULT city
// keeps its exact indexed strings — this page is indexed under "Istanbul
// directory", and rewording a title Google already has costs something for
// nothing.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { city } = await resolveCityForPage(searchParams)
  const isDefault = city.slug === DEFAULT_CITY_SLUG
  const title = `${city.name} Directory — Smileys Community`
  const desc  = isDefault
    ? 'Member-recommended businesses, services and places across Istanbul — cafés, doctors, gyms and more, vouched for by the Smileys community.'
    : `Member-recommended businesses, services and places across ${city.name} — cafés, doctors, gyms and more, vouched for by the Smileys community.`
  // Canonical rule from app/[city]/data.ts: another city's directory is
  // canonical at its crawlable hub (/[city]/directory); the default city's
  // stays here. og:url follows the canonical.
  const canonical = isDefault ? `${APP_URL}/directory` : `${APP_URL}/${city.slug}/directory`
  // The city's own cover or hero photo, never the default city's cover under
  // this city's name (lib/shareCover).
  const image = shareCover('directory', city, title)

  return {
    alternates: { canonical },
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      url: canonical,
      siteName: 'Smileys Community',
      type: 'website',
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: desc,
      images: [image.url],
    },
  }
}

export default async function DirectoryPage({ searchParams }: Props) {
  const { city, cityId, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the address
  // bar they copy is a link that survives being shared. Guarded on `pinned` so
  // this can't loop, and skipped for the default city to leave its established
  // bare URL (and its search ranking) alone. The filters the URL already
  // carries (?category=, ?q=, …) come along.
  if (!pinned && city.slug !== DEFAULT_CITY_SLUG) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      if (key === 'city' || value === undefined) continue
      for (const one of Array.isArray(value) ? value : [value]) qs.append(key, one)
    }
    qs.set('city', city.slug)
    redirect(`/directory?${qs}`)
  }

  return (
    <div className="bg-warm pb-20 md:pb-0">
      <DirectoryClient />
      {/* Cross-links — the shared surface grid (components/ExploreMore),
          inside the directory's own max-w-7xl container convention. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <ExploreMore current="directory" cityId={cityId} cityName={city.name} />
      </div>
    </div>
  )
}
