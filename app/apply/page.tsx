import type { Metadata } from 'next'
import { APP_URL } from '@/lib/env'
import { getPublicCity, DEFAULT_CITY_SLUG } from '@/lib/cities'
import ApplyClient, { type InitialCity } from './ApplyClient'
import { CITY_STATUS } from '@/lib/cityStatus'

// City-aware metadata. Homepage city cards and member invite links land here
// as /apply?city=<slug>; the OG card (the link-preview image on WhatsApp/
// iMessage) and the title must name THAT city, not a hardcoded Istanbul — a
// Bodrum founder's invite previewed as "Istanbul's curated social community"
// before this. Metadata has to live on a server component to read the param,
// which is why the form moved to ApplyClient and this wrapper exists.
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ city?: string }> },
): Promise<Metadata> {
  const citySlug = (await searchParams).city?.trim().toLowerCase()
  const city = citySlug ? await getPublicCity(citySlug) : null
  // A plain /apply is the network's application, not Istanbul's; a named city
  // says its name — without superlatives a city with no members yet
  // can't live up to.
  const cityName = city?.name ?? null
  const where    = cityName ? ` in ${cityName}` : ''
  const title    = cityName ? `Apply to Join Smileys ${cityName}` : 'Apply to Join Smileys'

  const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
    title,
    eyebrow: cityName ? `Smileys ${cityName}` : 'Curated city communities',
    cta:     '5-minute application',
  }).toString()}`

  const description = `Apply to join Smileys${where} — a curated community for internationals and locals who meet through events and clubs. The application takes about 5 minutes.`
  const url = city ? `${APP_URL}/apply?city=${encodeURIComponent(city.slug)}` : `${APP_URL}/apply`

  return {
    alternates: { canonical: `${APP_URL}/apply` },
    title: `${title} — Smileys Community`,
    description,
    openGraph: { title, description, url, images: [{ url: ogImage, width: 1200, height: 630, alt: title }] },
    twitter:   { card: 'summary_large_image', title, description, images: [ogImage] },
  }
}

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  // The city named in the link, resolved here so the form's first paint names
  // it (ApplyClient). Case-insensitive: ?city=Tbilisi fell back to Istanbul.
  const slug = (await searchParams).city?.trim().toLowerCase()
  // No (or an unknown) city → the default one, resolved here too, so the
  // form knows its stage from the first paint (what it may claim follows it).
  const city = (slug ? await getPublicCity(slug) : null) ?? await getPublicCity(DEFAULT_CITY_SLUG)
  const initialCity: InitialCity | null = city && city.status !== CITY_STATUS.Paused
    ? { slug: city.slug, name: city.name, status: city.status, maturity: city.stats?.maturity ?? null }
    : null
  return <ApplyClient initialCity={initialCity} />
}
