import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveCityForPage, type CitySearch } from '@/lib/cityPageParam'
import { APP_URL } from '@/lib/env'
import { shareCover } from '@/lib/shareCover'
import { getCityHostRoster } from '@/lib/hostRoster'
import { projectRosterForViewer } from '@/lib/hostTitles'
import HostRosterCard from '@/components/HostRosterCard'
import HostPath from '@/components/HostPath'

// Meet the Hosts (multi-city phase 2.1) — the people who make events happen,
// as a public surface, for the city the viewer is in (?city= first, then
// cookie / home city — resolveCityForPage, the rule every other hub uses).
// The crawlable fixed-city twin is /[city]/hosts; the roster, the titles and
// the guest rule are shared through lib/hostRoster + lib/hostTitles.
//
// Doubles as the host-recruitment funnel: the titles are visible, the path
// between them is stated, and the "Become a host" CTA is the pathway a
// launching city needs filled before it can go live.

interface Props { searchParams?: Promise<CitySearch> }

// Per city, like the experiences page: the metadata was a static export, so
// whichever city the cookie resolved to, the canonical named Istanbul's URL
// and there was no Open Graph block — shared, the page previewed as the
// homepage.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { city } = await resolveCityForPage(searchParams)
  const title       = `Meet the Hosts in ${city.name} — Smileys Community`
  const description = `The members who host Smileys events and lead ${city.name} — and how to become one of them.`
  const canonical   = city.slug === DEFAULT_CITY_SLUG ? `${APP_URL}/hosts` : `${APP_URL}/${city.slug}/hosts`
  const image = shareCover('hosts', city, title)
  return {
    title, description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, images: [image] },
    twitter: { card: image.twitterCard, title, description, images: [image.url] },
  }
}

export default async function HostsPage({ searchParams }: Props) {
  const { city, cityId, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the
  // address bar they copy survives being shared. Guarded on `pinned` so this
  // can't loop; the default city keeps its bare URL.
  if (!pinned && city.slug !== DEFAULT_CITY_SLUG) redirect(`/hosts?city=${city.slug}`)

  const session = await getSession()
  const hosts = projectRosterForViewer(await getCityHostRoster(cityId, city.timezone), !!session)

  const cityName = city.name

  return (
    <div className="min-h-screen bg-warm pb-20">
      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-2">Smileys {cityName}</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Meet the Hosts</h1>
          <p className="text-base text-gray-600 mt-2 max-w-2xl">
            A host isn&apos;t just an event organizer — they&apos;re the reason a room full of strangers
            turns into a community. These are the members who make {cityName} happen.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-8">
        {hosts.length === 0 ? (
          <div className="text-center py-16">
            <span aria-hidden="true" className="text-4xl block mb-3">🎤</span>
            <p className="font-semibold text-gray-900 mb-1">No hosts here yet</p>
            <p className="text-sm text-gray-600">This city is still finding its first hosts — maybe that&apos;s you?</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {hosts.map(h => <HostRosterCard key={h.id || h.name} host={h} signedIn={!!session} citySlug={city.slug} />)}
          </div>
        )}

        <HostPath cityName={cityName} className="mt-12" />

        {/* ── Become a host ── */}
        <div className="mt-8 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-8 text-center text-white">
          <h2 className="text-2xl font-extrabold mb-2">Could you be a host?</h2>
          <p className="text-amber-50 max-w-xl mx-auto mb-6">
            Hosts get support, visibility and the best seat in the house: watching people you
            brought together become friends. No experience needed — just care.
          </p>
          <Link href="/get-involved"
            className="inline-flex items-center gap-2 bg-white text-amber-600 font-bold px-8 py-3.5 rounded-xl hover:bg-amber-50 transition-colors">
            Become a host
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  )
}
