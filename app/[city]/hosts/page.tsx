import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'
import { shareCover } from '@/lib/shareCover'
import { getSession } from '@/lib/session'
import { getCityHostRoster } from '@/lib/hostRoster'
import { projectRosterForViewer, HOST_TITLE } from '@/lib/hostTitles'
import HostRosterCard from '@/components/HostRosterCard'
import HostPath from '@/components/HostPath'
import { hubCanonical } from '../data'

// /[city]/hosts — the crawlable Meet the Hosts for a fixed city. The global
// /hosts is the viewer's-city view (cookie-scoped, canonical for the default
// city); this is the page a search for "Smileys Tbilisi hosts" can land on,
// and the one the city page's Meet your hosts section links to. Canonical
// rule in ../data.ts, same as the other hubs.

interface Params { params: Promise<{ city: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title = `Meet the Hosts in ${city.name} — Smileys Community`
  const description = `The members who host Smileys events and lead ${city.name} — and how to become one of them.`
  const image = shareCover('hosts', city, title)
  return {
    title, description,
    alternates: { canonical: hubCanonical(city.slug, 'hosts') },
    openGraph: { title, description, url: `${APP_URL}/${city.slug}/hosts`, images: [image] },
    twitter: { card: image.twitterCard, title, description, images: [image.url] },
  }
}

export default async function CityHostsPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  // Per request, outside the cached roster: what this viewer may see.
  const session = await getSession()
  const hosts = projectRosterForViewer(await getCityHostRoster(city.id, city.timezone), !!session)
  const leads = hosts.filter(h => h.title === 'lead').length

  return (
    <>
      <section className="bg-gradient-to-b from-amber-50 via-white to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
          <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
            <span aria-hidden="true">←</span> Smileys {city.name}
          </Link>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-3">
            Meet the Hosts in <span className="text-amber-600">{city.name}</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            {hosts.length === 0
              ? `${city.name} is looking for its first hosts — the seat is open.`
              : `${hosts.length} host${hosts.length === 1 ? '' : 's'}${leads > 0 ? `, ${leads} ${leads === 1 ? HOST_TITLE.lead : `${HOST_TITLE.lead}s`}` : ''} — the members who make ${city.name} happen.`}
          </p>
        </div>
      </section>

      <section className="py-10 sm:py-14 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {hosts.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-gray-50 p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">No hosts here yet</h2>
              <p className="text-gray-600 mb-6 max-w-xl mx-auto">
                Every city starts with one person who decides to host the first thing. In {city.name}, that could be you.
              </p>
              <Link href="/get-involved" className="btn-primary inline-flex">Become a host</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {hosts.map(h => <HostRosterCard key={h.id || h.name} host={h} signedIn={!!session} citySlug={city.slug} />)}
            </div>
          )}

          <HostPath cityName={city.name} className="mt-12" />

          <div className="mt-8 text-center">
            <Link href="/get-involved" className="btn-primary text-base px-8 py-4 inline-flex">Become a host</Link>
          </div>
        </div>
      </section>
    </>
  )
}
