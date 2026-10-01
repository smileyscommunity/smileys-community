import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { redactEventForGuest, projectEventsForMember } from '@/lib/db'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL, SITE_URL } from '@/lib/env'
import { jsonLdHtml } from '@/lib/jsonLd'
import { eventListJsonLd } from '@/lib/eventJsonLd'
import { todayInTz } from '@/lib/cityTime'
import { EVENT_WINDOWS, WINDOW_LABEL, isEventWindow, inWindow, windowDates } from '@/lib/eventWindows'
import EventCard from '@/components/EventCard'
import { shareCover } from '@/lib/shareCover'
import JoinCityButton from '@/components/JoinCityButton'
import { getCityEventsHub, arrangeEvents, hubPath } from '../../data'

// /[city]/events/today | this-week | this-weekend — the crawlable answer to
// "events this weekend in <city>". Server-rendered from the same cached rows
// as the city's events hub, filtered by the city's own calendar day. Each page
// is canonical to itself and stays out of the index while it is empty (an
// empty "this weekend" is a thin page, not a result).

interface Params { params: Promise<{ city: string; when: string }> }

async function load(slug: string, when: string) {
  const city = await getPublicCity(slug)
  if (!city || !isEventWindow(when)) return null
  return { city, when }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug, when: raw } = await params
  const ctx = await load(slug, raw)
  if (!ctx || ctx.city.status !== CITY_STATUS.Live) return {}
  const { city, when } = ctx
  const today = todayInTz(city.timezone)
  const { events: cached } = await getCityEventsHub(city.id)
  const n = arrangeEvents(inWindow(cached, when, today)).length
  const label = WINDOW_LABEL[when]
  const dates = windowDates(when, today)
  const title = `Events in ${city.name} ${label} (${dates}) — Smileys Community`
  const description = n > 0
    ? `${n} social event${n === 1 ? '' : 's'} in ${city.name} ${label} — dinners, walks, language meetups and more, hosted by members. Free and paid; join Smileys to RSVP.`
    : `See what is on in ${city.name} ${label} and what is coming next — curated social events hosted by Smileys members.`
  const image = shareCover('events', city, `Events in ${city.name} ${label} — Smileys Community`)
  const url = `${APP_URL}/${city.slug}/events/${when}`
  return {
    title, description,
    alternates: { canonical: url },
    ...(n === 0 ? { robots: { index: false, follow: true } } : {}),
    openGraph: { title, description, url, images: [image] },
    twitter: { card: image.twitterCard, title, description, images: [image.url] },
  }
}

export default async function CityEventsWindowPage({ params }: Params) {
  const { city: slug, when: raw } = await params
  const ctx = await load(slug, raw)
  if (!ctx) notFound()
  const { city, when } = ctx
  // A pre-launch city has no calendar; its own page says what it is.
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const today = todayInTz(city.timezone)
  const { events: cached } = await getCityEventsHub(city.id)
  const session = await getSession()
  // Guest redaction per request, outside the shared cache — same as the hub.
  const rows = arrangeEvents(inWindow(session ? await projectEventsForMember(cached, session) : cached.map(redactEventForGuest), when, today))
  const label = WINDOW_LABEL[when]
  const jsonLd = eventListJsonLd(rows, city, { appUrl: APP_URL, siteUrl: SITE_URL })

  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />}
      <section className="bg-gradient-to-b from-amber-50 via-white to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
          <Link href={hubPath(city.slug, 'events')} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
            <span aria-hidden="true">←</span> All events in {city.name}
          </Link>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-3">
            Events in <span className="text-amber-600">{city.name}</span> {label}
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            {rows.length === 0
              ? `Nothing scheduled ${label} yet — here is what is coming up instead.`
              : `${rows.length} event${rows.length === 1 ? '' : 's'}, ${windowDates(when, today)} — hosted by Smileys members. Many are free; paid ones show the price before you RSVP.`}
          </p>
          <nav aria-label="Pick a day range" className="mt-6 flex flex-wrap gap-2">
            {EVENT_WINDOWS.map(w => (
              <Link key={w} href={`/${city.slug}/events/${w}`} aria-current={w === when ? 'page' : undefined}
                className={`px-4 py-2 rounded-full text-sm font-semibold border ${w === when ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-amber-300'}`}>
                {WINDOW_LABEL[w][0].toUpperCase() + WINDOW_LABEL[w].slice(1)}
              </Link>
            ))}
            <Link href={hubPath(city.slug, 'events')} className="px-4 py-2 rounded-full text-sm font-semibold border bg-white border-gray-200 text-gray-700 hover:border-amber-300">
              All upcoming
            </Link>
          </nav>
        </div>
      </section>

      <section className="py-10 sm:py-14 bg-gray-50 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {rows.length === 0 ? (
            <div className="rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">Nothing on {label}</h2>
              <p className="text-gray-600 mb-6 max-w-xl mx-auto">
                New events are added every week. Browse everything coming up, or join and be first to hear about the next one.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
                <Link href={hubPath(city.slug, 'events')} className="btn-secondary text-base px-8 py-4">See all upcoming events</Link>
                <JoinCityButton slug={city.slug} name={city.name} guest={!session} />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {rows.map(e => <EventCard key={e.id} event={e} timeZone={city.timezone} />)}
              </div>
              <div className="mt-10 flex justify-center">
                <JoinCityButton slug={city.slug} name={city.name} guest={!session} />
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}
