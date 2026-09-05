import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { APP_URL } from '@/lib/env'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveCityForPage } from '@/lib/cityPageParam'
import { shareCover } from '@/lib/shareCover'
import MarketplaceClient from './MarketplaceClient'

// Server wrapper around the marketplace browser (./MarketplaceClient). It
// resolves the city and owns the page's metadata; the client tree can't
// export any, and the layout this used to live in gets no searchParams.
//
// Which city: ?city= when the URL carries one, else the view-city cookie →
// member's home city → default (lib/cityPageParam). A link-preview crawler
// has neither session nor cookie, so without the param every share of
// /marketplace previewed as the default city's — name and cover — whatever
// city the sharer had on screen. The client passes the same ?city= to
// GET /api/listings, /api/neighborhoods and /api/city/current, so listings,
// filter, heading and this metadata agree.

type Search = Record<string, string | string[] | undefined>
interface Props { searchParams?: Promise<Search> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { city } = await resolveCityForPage(searchParams)
  const isDefault = city.slug === DEFAULT_CITY_SLUG
  const desc      = `Rooms, jobs, services, buy & sell and more — member-to-member listings from the Smileys community in ${city.name}.`
  const ogTitle   = `Smileys Marketplace — ${city.name}`
  // No crawlable hub for the marketplace, so each city's variant is its own
  // canonical; the default city keeps the bare URL it is indexed under.
  const canonical = isDefault ? `${APP_URL}/marketplace` : `${APP_URL}/marketplace?city=${city.slug}`
  // The city's own cover or hero photo, never the default city's cover under
  // this city's name (lib/shareCover).
  const image = shareCover('marketplace', city, ogTitle)

  return {
    alternates: { canonical },
    title: 'Marketplace — Smileys Community',
    description: desc,
    openGraph: {
      title: ogTitle,
      description: desc,
      url: canonical,
      siteName: 'Smileys Community',
      type: 'website',
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: desc,
      images: [image.url],
    },
  }
}

export default async function MarketplacePage({ searchParams }: Props) {
  const { city, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the address
  // bar they copy is a link that survives being shared. Guarded on `pinned` so
  // this can't loop, and skipped for the default city to leave its established
  // bare URL alone. The filters and deep links the URL already carries
  // (?tab=, ?q=, ?l=, …) come along.
  if (!pinned && city.slug !== DEFAULT_CITY_SLUG) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      if (key === 'city' || value === undefined) continue
      for (const one of Array.isArray(value) ? value : [value]) qs.append(key, one)
    }
    qs.set('city', city.slug)
    redirect(`/marketplace?${qs}`)
  }

  return <MarketplaceClient />
}
