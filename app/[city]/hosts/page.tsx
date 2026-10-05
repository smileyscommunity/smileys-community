import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { shareCover } from '@/lib/shareCover'
import { getSession } from '@/lib/session'
import { getCityHostRoster, rosterForViewer } from '@/lib/hostRoster'
import HostsHub from '@/components/HostsHub'
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
  // og:url is the canonical — for the default city that is the bare /hosts,
  // and a share card that names a different URL than the canonical splits
  // the page's signals.
  const canonical = hubCanonical(city.slug, 'hosts')
  return {
    title, description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, images: [image] },
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
  const hosts = await rosterForViewer(await getCityHostRoster(city.id, city.timezone), session)

  return <HostsHub city={city} hosts={hosts} signedIn={!!session} />
}
