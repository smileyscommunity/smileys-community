import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { redactEventForGuest } from '@/lib/db'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL, SITE_URL } from '@/lib/env'
import { jsonLdHtml } from '@/lib/jsonLd'
import { eventListJsonLd } from '@/lib/eventJsonLd'
import { headers } from 'next/headers'
import EventCard from '@/components/EventCard'
import JoinCityButton from '@/components/JoinCityButton'
import { getCityEventsHub, arrangeEvents, enterLinkFor, hubCanonical, isDefaultCitySlug } from '../data'

// /[city]/events — the crawlable list of a city's upcoming events. The global
// /events is the members' interactive calendar (client-rendered, scoped by
// the view-city cookie); this is the fixed-city, server-rendered page a
// search engine can read and a link can point at. See the hub note in
// ../data.ts for the canonical rule.

interface Params { params: Promise<{ city: string }> }

const ogImage = `${APP_URL}/images/events-og.jpg`

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title = `Events in ${city.name} — Smileys Community`
  const description = `Discover curated social events in ${city.name} — dinners, photowalks, language meetups and more. Join Smileys and find your next experience.`
  return {
    title, description,
    alternates: { canonical: hubCanonical(city.slug, 'events') },
    openGraph: {
      title, description,
      url: `${APP_URL}/${city.slug}/events`,
      images: [{ url: ogImage, width: 1200, height: 1200, alt: 'Smileys Events — every week, new experiences, lasting memories' }],
    },
    twitter: { card: 'summary', title, description, images: [ogImage] },
  }
}

export default async function CityEventsPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  // A pre-launch city has no calendar; its own page says what it is.
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const { events: cached, total } = await getCityEventsHub(city.id)
  // Guest redaction is per-request, outside the shared cache — same rule as
  // the city page and GET /api/events.
  const session = await getSession()
  const events  = arrangeEvents(session ? cached : cached.map(redactEventForGuest))
  const enter   = enterLinkFor(city.slug)
  const isDefault = isDefaultCitySlug(city.slug)

  // The crawlable list of events, as data. Built from the same rows the cards
  // below render — a listing whose structured data disagrees with its visible
  // content is worse than none. Redacted rows are fine here: nothing in the
  // markup is member-private (title, date, place, link).
  const eventsJsonLd = eventListJsonLd(events, city, { appUrl: APP_URL, siteUrl: SITE_URL })
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <>
      {eventsJsonLd && (
        <script type="application/ld+json" nonce={nonce}
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(eventsJsonLd) }} />
      )}
      <section className="bg-gradient-to-b from-amber-50 via-white to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
          <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
            <span aria-hidden="true">←</span> Smileys {city.name}
          </Link>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-3">
            Events in <span className="text-amber-600">{city.name}</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            {events.length === 0
              ? `The first dinners, walks and meetups in ${city.name} start with the first members.`
              : `${total} upcoming event${total === 1 ? '' : 's'} — dinners, walks, language meetups and more, hosted by members.`}
          </p>
        </div>
      </section>

      <section className="py-10 sm:py-14 bg-gray-50 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {events.length === 0 ? (
            <div className="rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">Events are coming soon</h2>
              <p className="text-gray-600 mb-6 max-w-xl mx-auto">
                Be one of the first to help build Smileys {city.name}.
              </p>
              <div className="flex justify-center">
                <JoinCityButton slug={city.slug} name={city.name} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map(e => <EventCard key={e.id} event={e} />)}
            </div>
          )}
          <div className="mt-10 flex flex-col sm:flex-row gap-4 items-center justify-center">
            <JoinCityButton slug={city.slug} name={city.name} />
            {/* The interactive calendar — filters, tabs, your RSVPs — via the
                cookie-setting entry so it opens on THIS city. */}
            <a href={enter('events')} className="btn-secondary text-base px-8 py-4">
              {total > events.length
                ? `See all ${total} events`
                : isDefault ? 'Open the full calendar' : `Open the ${city.name} calendar`}
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
