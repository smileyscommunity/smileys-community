import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL, SITE_URL } from '@/lib/env'
import { jsonLdHtml } from '@/lib/jsonLd'
import { eventListJsonLd } from '@/lib/eventJsonLd'
import { shareCover } from '@/lib/shareCover'
import JoinCityButton from '@/components/JoinCityButton'
import { getExperiencesData } from '@/app/experiences/data'
import Shelves from '@/app/experiences/Shelves'
import { hubCanonical, isDefaultCitySlug } from '../data'

// /[city]/experiences — the crawlable shelves of a fixed city. The global
// /experiences follows the viewer (cookie or ?city=); this is the page a
// search for "things to do in Izmir with Smileys" can land on, and the URL
// another city's shelves are canonical at. Canonical rule in ../data.ts,
// same as the other hubs; the shelves and their rules are shared with the
// global page (app/experiences/data, lib/experiences).

interface Params { params: Promise<{ city: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title       = `Experiences in ${city.name} — Smileys Community`
  const description = `Sailing, workshops, day trips and culture — curated experiences you can join with the Smileys community in ${city.name}.`
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

  const { shelves, events } = await getExperiencesData(city.id)
  const jsonLd = eventListJsonLd(events.filter(e => e.status !== 'cancelled'), city, { appUrl: APP_URL, siteUrl: SITE_URL })
  const eventsHref = isDefaultCitySlug(city.slug) ? '/events' : `/${city.slug}/events`

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
          <p className="text-lg text-gray-600 max-w-2xl">
            {shelves.length === 0
              ? `The first sailing trips, walks and workshops in ${city.name} start with the first members.`
              : `Sailing, workshops, day trips, culture — the experiences worth having in ${city.name}, joined with people worth having them with.`}
          </p>
        </div>
      </section>

      <section className="py-10 sm:py-14 bg-warm border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
          <Shelves shelves={shelves} eventsHref={eventsHref} />
          <div className="flex justify-center">
            <JoinCityButton slug={city.slug} name={city.name} />
          </div>
        </div>
      </section>
    </>
  )
}
