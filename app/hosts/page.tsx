import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveCityForPage, type CitySearch } from '@/lib/cityPageParam'
import { APP_URL } from '@/lib/env'
import { shareCover } from '@/lib/shareCover'
import { getCityHostRoster, rosterForViewer } from '@/lib/hostRoster'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import HostsHub from '@/components/HostsHub'

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
  // A member whose home city is not live yet got that city's roster here
  // while /[city]/hosts sent them to the city page; same rule on both.
  const pub = await getPublicCity(city.slug)
  if (!pub || pub.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const session = await getSession()
  const hosts = await rosterForViewer(await getCityHostRoster(cityId, city.timezone), session)

  return <HostsHub city={city} hosts={hosts} signedIn={!!session} />
}
