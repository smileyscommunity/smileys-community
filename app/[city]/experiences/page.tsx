import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL, SITE_URL } from '@/lib/env'
import { jsonLdHtml } from '@/lib/jsonLd'
import { eventListJsonLd } from '@/lib/eventJsonLd'
import { shareCover } from '@/lib/shareCover'
import { getSession } from '@/lib/session'
import { describeShelves } from '@/lib/experiences'
import JoinCityButton from '@/components/JoinCityButton'
import { getExperiencesData, shelfViewer, fallbackEvents } from '@/app/experiences/data'
import Shelves from '@/app/experiences/Shelves'
import NothingYet from '@/app/experiences/NothingYet'
import Crosslinks from '@/app/experiences/Crosslinks'
import { hubCanonical, isDefaultCitySlug } from '../data'

// /[city]/experiences — the crawlable shelves of a fixed city. The global
// /experiences follows the viewer (cookie or ?city=); this is the page a
// search for "things to do in Izmir with Smileys" can land on, and the URL
// another city's shelves are canonical at. Canonical rule in ../data.ts,
// same as the other hubs; the shelves and their rules are shared with the
// global page (app/experiences/data, lib/experiences).

interface Params { params: Promise<{ city: string }> }

// Same rule as the global page: the copy names what is on the shelves.
function intro(shelfNames: string[], cityName: string): string {
  const what = describeShelves(shelfNames)
  return what
    ? `${what} — the experiences worth having in ${cityName}, joined with people worth having them with.`
    : `Experiences you can join with the Smileys community in ${cityName}, as hosts schedule them.`
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title       = `Experiences in ${city.name} — Smileys Community`
  const { shelves } = await getExperiencesData(city.id)
  const description = intro(shelves.map(s => s.name), city.name)
  const image = shareCover('experiences', city, title)
  return {
    title, description,
    alternates: { canonical: hubCanonical(city.slug, 'experiences') },
    openGraph: { title, description, url: `${APP_URL}/${city.slug}/experiences`, images: [image] },
    twitter: { card: image.twitterCard, title, description, images: [image.url] },
  }
}

export default async function CityExperiencesPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  // A pre-launch city has nothing to join yet; its own page says what it is.
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const session = await getSession()
  const { shelves, events } = await getExperiencesData(city.id)
  const [viewer, fallback] = await Promise.all([
    shelfViewer(session, events.map(e => e.id)),
    shelves.length === 0 ? fallbackEvents(city.id, session) : Promise.resolve([]),
  ])
  const jsonLd = eventListJsonLd(events.filter(e => e.status !== 'cancelled'), city, { appUrl: APP_URL, siteUrl: SITE_URL })
  const isDefault  = isDefaultCitySlug(city.slug)
  const eventsHref = isDefault ? '/events' : `/${city.slug}/events`
  const guideHref  = isDefault ? '/guide'  : `/guide?city=${city.slug}`

  return (
    <>
      {jsonLd && (
        <script type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      )}
      <section className="bg-gradient-to-b from-amber-50 via-white to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-8">
          <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
            <span aria-hidden="true">←</span> Smileys {city.name}
          </Link>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-3">
            Experiences in <span className="text-amber-600">{city.name}</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">{intro(shelves.map(s => s.name), city.name)}</p>
        </div>
      </section>

      <section className="py-10 sm:py-14 bg-warm border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
          {shelves.length === 0
            ? <NothingYet city={city} events={fallback} eventsHref={eventsHref} guest={!session} />
            : <Shelves shelves={shelves} viewer={viewer} />}
          <Crosslinks cityName={city.name} guideHref={guideHref} eventsHref={eventsHref} />
          {/* The empty state carries its own join button when the city has
              no events at all; a second one under it read as a glitch. */}
          {!session && shelves.length > 0 && (
            <div className="flex justify-center">
              <JoinCityButton slug={city.slug} name={city.name} guest={!session} />
            </div>
          )}
        </div>
      </section>
    </>
  )
}
