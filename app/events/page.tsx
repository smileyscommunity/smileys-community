import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { APP_URL, SITE_URL } from '@/lib/env'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveCityForPage } from '@/lib/cityPageParam'
import { shareCover } from '@/lib/shareCover'
import { getCityEventsHub } from '@/app/[city]/data'
import { jsonLdHtml } from '@/lib/jsonLd'
import { eventListJsonLd } from '@/lib/eventJsonLd'
import EventsClient from './EventsClient'

// Server wrapper around the interactive calendar (./EventsClient). It
// resolves the city, owns the page's metadata and emits the event list as
// structured data; the client tree can't export metadata, and the layout
// this used to live in got no searchParams. events/[id] sets its own
// metadata and JSON-LD, so nothing here reaches the detail pages.
//
// Which city: ?city= when the URL carries one, else the view-city cookie →
// member's home city → default (lib/cityPageParam). A link-preview crawler
// has neither session nor cookie, so without the param every share of
// /events previewed as the default city's — name and card — whatever city
// the sharer had on screen. The client passes the same ?city= to
// GET /api/events, so the list, its heading and this metadata agree.

type Search = Record<string, string | string[] | undefined>
interface Props { searchParams?: Promise<Search> }

// Names the city whose events you're actually being shown. The DEFAULT city
// keeps its exact indexed strings — this page is indexed under "events in
// Istanbul", and rewording a title Google already has costs something for
// nothing.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { city } = await resolveCityForPage(searchParams)
  const name      = city.name
  const isDefault = city.slug === DEFAULT_CITY_SLUG
  const title     = `Events in ${name} — Smileys Community`
  const desc      = isDefault
    ? 'Discover curated social events in Istanbul — dinners, photowalks, sailing trips, language meetups and more. Join Smileys and find your next experience.'
    : `Discover curated social events in ${name} — dinners, photowalks, language meetups and more. Join Smileys and find your next experience.`
  const ogDesc    = isDefault
    ? 'Meet people, try something new and experience Istanbul together.'
    : `Meet people, try something new and experience ${name} together.`
  // Canonical rule from app/[city]/data.ts: another city's list is canonical
  // at its crawlable hub (/[city]/events); the default city's stays here,
  // which Google already has. og:url follows the canonical.
  const canonical = isDefault ? `${APP_URL}/events` : `${APP_URL}/${city.slug}/events`
  // The city's own cover or hero photo; the default city keeps the branded
  // square card (lib/shareCover).
  const image = shareCover('events', city, 'Smileys Events — every week, new experiences, lasting memories')

  return {
    alternates: { canonical },
    title,
    description: desc,
    openGraph: {
      title: 'Smileys Events — Find something worth showing up for.',
      description: ogDesc,
      url: canonical,
      images: [image],
    },
    twitter: {
      card: image.twitterCard,
      title: 'Smileys Events — Find something worth showing up for.',
      description: ogDesc,
      images: [image.url],
    },
  }
}

export default async function EventsPage({ searchParams }: Props) {
  const { city, cityId, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the address
  // bar they copy is a link that survives being shared. Guarded on `pinned` so
  // this can't loop, and skipped for the default city to leave its established
  // bare URL alone. The filters the URL already carries (?tab=, ?time=,
  // ?tags=, …) come along.
  if (!pinned && city.slug !== DEFAULT_CITY_SLUG) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      if (key === 'city' || value === undefined) continue
      for (const one of Array.isArray(value) ? value : [value]) qs.append(key, one)
    }
    qs.set('city', city.slug)
    redirect(`/events?${qs}`)
  }

  // The calendar is client-rendered, so a crawler reaching here sees an empty
  // shell — and for the default city this is the canonical URL Google ranks.
  // The list goes out as structured data from the same rows and cache as the
  // /[city]/events hub.
  const { events } = await getCityEventsHub(cityId)
  const jsonLd = eventListJsonLd(events, city, { appUrl: APP_URL, siteUrl: SITE_URL })
  const nonce  = (await headers()).get('x-nonce') ?? undefined
  return (
    <>
      {jsonLd && (
        <script type="application/ld+json" nonce={nonce}
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      )}
      <EventsClient />
    </>
  )
}
