import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { redactEventForGuest, projectEventsForMember } from '@/lib/db'
import CityPageTracker from '@/components/CityPageTracker'
import { eventWindowFor } from '@/lib/data'
import { toEventCard } from '@/lib/eventCard'
import { getPublicCity, DEFAULT_CITY_SLUG } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'
import { jsonLdHtml } from '@/lib/jsonLd'
import { getCityHandbookPicks } from '@/lib/cityHandbookPicks'
import { cityMetadata, getCityPageData, getVisitors, getCityHosts, getTopNeighborhoods, getGuidePicks, arrangeEvents, featureClubs, enterLinkFor, publicLinkFor } from './data'
import PreLaunch from './sections/PreLaunch'
import Hero from './sections/Hero'
import Events from './sections/Events'
import Clubs from './sections/Clubs'
import Hosts from './sections/Hosts'
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

// The page's own structured data: where it sits (Smileys › Cities › the
// city) and what it is about. The only block on the page was the layout's
// Organization. City columns only — no member ever appears here.
function CityJsonLd({ city }: { city: { slug: string; name: string; tagline?: string | null } }) {
  const url = `${APP_URL}/${city.slug}`
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage', '@id': url, url, name: `Smileys ${city.name}`,
        ...(city.tagline ? { description: city.tagline } : {}),
        about: { '@type': 'City', name: city.name },
        isPartOf: { '@type': 'WebSite', url: APP_URL, name: 'Smileys Community' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Smileys', item: APP_URL },
          { '@type': 'ListItem', position: 2, name: 'Cities', item: `${APP_URL}/cities` },
          { '@type': 'ListItem', position: 3, name: city.name, item: url },
        ],
      },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }} />
}

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

  // Read before the pre-launch gate: the holding page's one button needs to
  // know whether it is talking to a guest (JoinCityButton `guest`).
  const session = await getSession()
  if (city.status !== CITY_STATUS.Live) return <><CityJsonLd city={city} /><PreLaunch city={city} signedIn={!!session} /></>

  const { events: cachedEvents, clubs, neighborhoodCounts, testimonials, newMembersThisWeek, guideEntries, latestStories } =
    await getCityPageData(city.id, city.timezone, city.country ?? null)

  // Guest redaction happens per-request, OUTSIDE the shared cache entry —
  // a session-dependent branch must never write into unstable_cache. Same
  // projection as GET /api/events.
  const events  = session ? await projectEventsForMember(cachedEvents, session) : cachedEvents.map(redactEventForGuest)

  const [{ visitors, visitorTotal }, { hosts, hostTotal }, { topNeighborhoods, neighborhoodsHaveEvents, neighborhoodTotal }, handbookPicks, guidePicks] = await Promise.all([
    getVisitors(city, !!session),
    getCityHosts(city, session),
    getTopNeighborhoods(city.id, neighborhoodCounts),
    getCityHandbookPicks(city.id),
    getGuidePicks(city.id),
  ])

  // Cut to what a card renders (lib/eventCard): EventTabs is a client list.
  const tabEvents = arrangeEvents(events).map(toEventCard)
  // The city's own week and weekend — this page had been computing them in
  // the founding city's terms, on a page whose entire subject is another city.
  const eventWindow   = eventWindowFor(city.timezone)
  const featuredClubs = featureClubs(clubs)
  // Members enter the interactive, cookie-scoped views; guests (and crawlers)
  // get the crawlable per-city hubs for events and clubs — see publicLinkFor.
  const enter         = session ? enterLinkFor(city.slug) : publicLinkFor(city.slug, enterLinkFor(city.slug))
  const isDefaultCity = city.slug === DEFAULT_CITY_SLUG
  const guide         = <Guide city={city} hasGuide={guideEntries > 0} enter={enter} handbookPicks={handbookPicks} guidePicks={guidePicks} />

  return (
    <>
      <CityJsonLd city={city} />
      <CityPageTracker slug={city.slug} status={city.status} />
      <Hero city={city} enter={enter} signedIn={!!session} />
      {/* The guide is the one section a visitor can use before joining
          anything, so it sits right after the events — and ahead of them
          while the calendar is empty, rather than opening the page on
          "Events are coming soon". */}
      {tabEvents.length === 0 && guide}
      <Events city={city} tabEvents={tabEvents} eventWindow={eventWindow} enter={enter} signedIn={!!session} />
      {tabEvents.length > 0 && guide}
      <Clubs city={city} featuredClubs={featuredClubs} enter={enter} signedIn={!!session} />
      <Hosts city={city} hosts={hosts} hostTotal={hostTotal} signedIn={!!session} />
      <Neighborhoods city={city} topNeighborhoods={topNeighborhoods} neighborhoodsHaveEvents={neighborhoodsHaveEvents} neighborhoodTotal={neighborhoodTotal} enter={enter} />
      <Visitors city={city} visitors={visitors} visitorTotal={visitorTotal} isDefaultCity={isDefaultCity} signedIn={!!session} />
      <Stories city={city} latestStories={latestStories} />
      <Testimonials city={city} testimonials={testimonials} />
      <FinalCta city={city} signedIn={!!session} newMembersThisWeek={newMembersThisWeek} enter={enter} hasEvents={tabEvents.length > 0} />
    </>
  )
}
