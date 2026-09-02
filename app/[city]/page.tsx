import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { redactEventForGuest } from '@/lib/db'
import CityPageTracker from '@/components/CityPageTracker'
import { eventWindowFor } from '@/lib/data'
import { getPublicCity, DEFAULT_CITY_SLUG } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { cityMetadata, getCityPageData, getVisitors, getTopNeighborhoods, arrangeEvents, featureClubs, enterLinkFor } from './data'
import PreLaunch from './sections/PreLaunch'
import Hero from './sections/Hero'
import Events from './sections/Events'
import Clubs from './sections/Clubs'
import Neighborhoods from './sections/Neighborhoods'
import Visitors from './sections/Visitors'
import Guide from './sections/Guide'
import Stories from './sections/Stories'
import Testimonials from './sections/Testimonials'
import FinalCta from './sections/FinalCta'

// The per-city shopfront: /app/istanbul today, /app/athens the moment an admin
// flips Athens to live. Nothing here names a city — everything comes from the
// city record — which is the whole point of the multi-city architecture. If you
// find yourself writing "Istanbul" into this file, it belongs in the city's
// `tagline`/`description` column instead.
//
// This is a dynamic segment at the site root, so it only catches paths no
// static route claims (/events, /clubs, /about … all still win). Unknown slugs
// fall through to notFound().
//
// Layout of this folder: ./data.ts loads and arranges (and draws the line
// between the shared, cached city data and the per-request reads that depend
// on who is looking); ./sections/* are markup only, one file per stripe of
// the page. This file just composes them, in page order.

interface Params { params: Promise<{ city: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) return {}
  return cityMetadata(city)
}

export default async function CityPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()

  if (city.status !== CITY_STATUS.Live) return <PreLaunch city={city} />

  const { events: cachedEvents, clubs, neighborhoodCounts, testimonials, newMembersThisWeek, guideEntries, latestStories } =
    await getCityPageData(city.id, city.timezone)

  // Guest redaction happens per-request, OUTSIDE the shared cache entry —
  // a session-dependent branch must never write into unstable_cache. Same
  // projection as GET /api/events.
  const session = await getSession()
  const events  = session ? cachedEvents : cachedEvents.map(redactEventForGuest)

  const [{ visitors, visitorTotal }, { topNeighborhoods, neighborhoodsHaveEvents }] = await Promise.all([
    getVisitors(city, !!session),
    getTopNeighborhoods(city.id, neighborhoodCounts),
  ])

  const tabEvents = arrangeEvents(events)
  // The city's own week and weekend — this page had been computing them in
  // the founding city's terms, on a page whose entire subject is another city.
  const eventWindow   = eventWindowFor(city.timezone)
  const featuredClubs = featureClubs(clubs)
  const enter         = enterLinkFor(city.slug)
  const isDefaultCity = city.slug === DEFAULT_CITY_SLUG

  return (
    <>
      <CityPageTracker slug={city.slug} status={city.status} />
      <Hero city={city} enter={enter} />
      <Events city={city} tabEvents={tabEvents} eventWindow={eventWindow} />
      <Clubs city={city} featuredClubs={featuredClubs} enter={enter} />
      <Neighborhoods city={city} topNeighborhoods={topNeighborhoods} neighborhoodsHaveEvents={neighborhoodsHaveEvents} enter={enter} />
      <Visitors city={city} visitors={visitors} visitorTotal={visitorTotal} isDefaultCity={isDefaultCity} />
      <Guide city={city} hasGuide={guideEntries > 0} enter={enter} />
      <Stories latestStories={latestStories} />
      <Testimonials testimonials={testimonials} />
      <FinalCta city={city} signedIn={!!session} newMembersThisWeek={newMembersThisWeek} enter={enter} />
    </>
  )
}
