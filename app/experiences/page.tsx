import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { APP_URL, SITE_URL } from '@/lib/env'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { getSession } from '@/lib/session'
import { resolveCityForPage } from '@/lib/cityPageParam'
import { shareCover } from '@/lib/shareCover'
import { jsonLdHtml } from '@/lib/jsonLd'
import { eventListJsonLd } from '@/lib/eventJsonLd'
import { describeShelves } from '@/lib/experiences'
import { getExperiencesData, shelfViewer, fallbackEvents } from './data'
import Shelves from './Shelves'
import NothingYet from './NothingYet'
import Crosslinks from './Crosslinks'

// Experiences (multi-city phase 2.4) — the bookable layer: sailing,
// workshops, day trips, culture. Deliberately NOT a new content type. The
// Guide answers "what should I experience here" (editorial); this page
// answers "what can I actually join" — and that already exists as events
// carrying Experience-group vibe tags. This surface curates them into
// shelves, one per event, grouped by series so "Sunset Sailing Cruise" is
// one card with a cadence line, not five near-identical cards.
// Sponsorship/partner slots can attach here later without a schema change.
//
// Which city: ?city= when the URL carries one, else the view-city cookie →
// member's home city → default (lib/cityPageParam) — the same rule as
// /events. A crawler carries no cookie, so without the param every city's
// shelves were served under one canonical and one Istanbul title. Another
// city's shelves are canonical at its crawlable hub (/[city]/experiences);
// the default city's stay here.

type Search = Record<string, string | string[] | undefined>
interface Props { searchParams?: Promise<Search> }

// The hero and the snippet say what is on the page, not what the page was
// meant for: "Sailing, workshops, day trips" over a calendar of hikes and
// plays promised things nobody could join.
function intro(shelfNames: string[], cityName: string): string {
  const what = describeShelves(shelfNames)
  return what
    ? `${what} — the experiences worth having in ${cityName}, joined with people worth having them with.`
    : `Experiences you can join with the Smileys community in ${cityName}, as hosts schedule them.`
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { city, cityId } = await resolveCityForPage(searchParams)
  const isDefault   = city.slug === DEFAULT_CITY_SLUG
  const title       = `Experiences in ${city.name} — Smileys Community`
  const { shelves } = await getExperiencesData(cityId)
  const description = intro(shelves.map(s => s.name), city.name)
  const canonical   = isDefault ? `${APP_URL}/experiences` : `${APP_URL}/${city.slug}/experiences`
  // The city's own cover or hero photo; the brand card only when it has
  // neither (lib/shareCover).
  const image = shareCover('experiences', city, title)
  return {
    title, description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, images: [image] },
    twitter: { card: image.twitterCard, title, description, images: [image.url] },
  }
}

export default async function ExperiencesPage({ searchParams }: Props) {
  const { city, cityId, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the
  // address bar they copy survives being shared. Guarded on `pinned` so this
  // can't loop; the default city keeps its bare URL.
  if (!pinned && city.slug !== DEFAULT_CITY_SLUG) redirect(`/experiences?city=${city.slug}`)

  const session = await getSession()
  const { shelves, events } = await getExperiencesData(cityId)
  const [viewer, fallback] = await Promise.all([
    shelfViewer(session, events.map(e => e.id)),
    shelves.length === 0 ? fallbackEvents(cityId, session) : Promise.resolve([]),
  ])
  // The same rows as the shelves, once each, as structured data. Cancelled
  // rows stay on the shelf so the card can say why; they are not
  // "EventScheduled" for a crawler.
  const jsonLd = eventListJsonLd(events.filter(e => e.status !== 'cancelled'), city, { appUrl: APP_URL, siteUrl: SITE_URL })
  // Hand-offs stay on this viewer's city: the cookie carries it for the
  // default city, ?city= for anyone pinned elsewhere.
  const qs = pinned && city.slug !== DEFAULT_CITY_SLUG ? `?city=${city.slug}` : ''
  const eventsHref = `/events${qs}`
  const guideHref  = `/guide${qs}`

  return (
    <div className="min-h-screen bg-warm pb-20">
      {jsonLd && (
        <script type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      )}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-2">Smileys {city.name}</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Experiences</h1>
          <p className="text-base text-gray-600 mt-2 max-w-2xl">{intro(shelves.map(s => s.name), city.name)}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 space-y-12">
        {shelves.length === 0
          ? <NothingYet city={city} events={fallback} eventsHref={eventsHref} />
          : <Shelves shelves={shelves} viewer={viewer} />}
        <Crosslinks cityName={city.name} guideHref={guideHref} eventsHref={eventsHref} />
      </div>
    </div>
  )
}
