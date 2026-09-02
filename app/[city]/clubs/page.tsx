import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL, SITE_URL } from '@/lib/env'
import { jsonLdHtml } from '@/lib/jsonLd'
import { resolveImageUrl } from '@/lib/data'
import ClubCard from '@/components/ClubCard'
import { getCityClubsHub, enterLinkFor, hubCanonical, isDefaultCitySlug } from '../data'

// /[city]/clubs — the crawlable grid of a city's clubs. The global /clubs is
// the members' view (client-rendered, cookie-scoped, and its JSON-LD names
// the default city only); this is the fixed-city page. Canonical rule in
// ../data.ts.

interface Params { params: Promise<{ city: string }> }

const ogImage = `${APP_URL}/images/clubs-og.jpg`

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title = `Clubs in ${city.name} — Smileys Community`
  const description = `Join interest-based clubs in ${city.name} — hiking, photography, language conversation, book clubs and more. Find your people at Smileys.`
  return {
    title, description,
    alternates: { canonical: hubCanonical(city.slug, 'clubs') },
    openGraph: {
      title, description,
      url: `${APP_URL}/${city.slug}/clubs`,
      images: [{ url: ogImage, width: 1200, height: 1200, alt: 'Smileys Clubs — do more, meet more, live more' }],
    },
    twitter: { card: 'summary', title, description, images: [ogImage] },
  }
}

function absoluteImageUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const resolved = resolveImageUrl(path)
  if (!resolved) return undefined
  return resolved.startsWith('http') ? resolved : `${SITE_URL}${resolved}`
}

export default async function CityClubsPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const { clubs, total } = await getCityClubsHub(city.id)
  const enter = enterLinkFor(city.slug)
  const isDefault = isDefaultCitySlug(city.slug)

  // Same ItemList the global layout emits for the default city — here for
  // every city, over its own clubs. Nonce from the middleware, as everywhere.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type':    'ItemList',
    itemListElement: clubs.map((c, i) => ({
      '@type':  'ListItem',
      position: i + 1,
      item: {
        '@type':     'Organization',
        name:        c.name,
        description: c.description?.slice(0, 300) || undefined,
        url:         `${APP_URL}/clubs/${c.slug}`,
        image:       absoluteImageUrl(c.coverImage),
      },
    })),
  }

  return (
    <>
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <section className="bg-gradient-to-b from-amber-50 via-white to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
          <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
            <span aria-hidden="true">←</span> Smileys {city.name}
          </Link>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-3">
            Clubs in <span className="text-amber-600">{city.name}</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            {clubs.length === 0
              ? `The first clubs in ${city.name} are started by members like you.`
              : `${total} club${total === 1 ? '' : 's'} — every interest covered, join as many as you like.`}
          </p>
        </div>
      </section>

      <section className="py-10 sm:py-14 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {clubs.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-gray-50 p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">Clubs are forming</h2>
              <p className="text-gray-600 mb-6 max-w-xl mx-auto">
                Have an activity you want to organize in {city.name}? The first clubs are started by members like you.
              </p>
              <Link href="/get-involved" className="btn-primary inline-flex">Become a host</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {clubs.map(club => <ClubCard key={club.id} club={club} hideEmptyNextEvent />)}
            </div>
          )}
          <div className="mt-10 text-center">
            <a href={enter('clubs')} className="btn-secondary text-base px-8 py-4">
              {total > clubs.length
                ? `See all ${total} clubs`
                : isDefault ? 'Browse clubs with filters' : `Browse ${city.name} clubs with filters`}
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
