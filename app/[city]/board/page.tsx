import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'
import { TEASER_DESCRIPTION_LIMIT } from '@/lib/listingsPublic'
import { listingCategory } from '@/lib/listingCategories'
import { getCityBoardHub, enterLinkFor, hubCanonical, isDefaultCitySlug } from '../data'

// /[city]/board — the crawlable list of a city's community board listings.
// The global /board is the interactive hub (client-rendered, scoped by the
// view-city cookie); this is the fixed-city page. The loader selects public
// fields only; guests additionally get the listings API's teaser (short
// text, anonymised poster). Canonical rule in ../data.ts.

interface Params { params: Promise<{ city: string }> }

const ogImage = `${APP_URL}/images/board-cover.jpg`

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title = `${city.name} Community Board — Smileys Community`
  const description = `Rooms, jobs, services, recommendations and more from the Smileys community in ${city.name} — ask, share, connect.`
  return {
    title, description,
    alternates: { canonical: hubCanonical(city.slug, 'board') },
    openGraph: {
      title, description, url: `${APP_URL}/${city.slug}/board`, siteName: 'Smileys Community', type: 'website',
      images: [{ url: ogImage, secureUrl: ogImage, width: 1200, height: 800, alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  }
}

export default async function CityBoardPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const { listings: cached, total } = await getCityBoardHub(city.id)
  // The loader never fetches the member-only fields; what a guest still
  // shouldn't see — who posted, the full text — is the same teaser the
  // listings API serves, applied per request.
  const session  = await getSession()
  const listings = session ? cached : cached.map(l => ({
    ...l,
    description: l.description.length > TEASER_DESCRIPTION_LIMIT
      ? l.description.slice(0, TEASER_DESCRIPTION_LIMIT).trimEnd() + '…'
      : l.description,
    user: { name: 'Smileys member' },
  }))
  const enter    = enterLinkFor(city.slug)
  const isDefault = isDefaultCitySlug(city.slug)

  return (
    <div className="bg-warm pb-20 md:pb-0">
      <section className="bg-gradient-to-b from-amber-50 via-white to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
          <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
            <span aria-hidden="true">←</span> Smileys {city.name}
          </Link>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-3">
            The <span className="text-amber-600">{city.name}</span> community board
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            {total === 0
              ? `Rooms, jobs, services and recommendations from members in ${city.name} — the first posts come from the first members.`
              : `${total} live post${total === 1 ? '' : 's'} — rooms, jobs, services, recommendations and more, from members.`}
          </p>
        </div>
      </section>

      <section className="py-10 sm:py-14 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {listings.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-white p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">Nothing posted yet</h2>
              <p className="text-gray-600 max-w-xl mx-auto">The board fills up as members arrive. Join Smileys {city.name} and post the first one.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {listings.map(l => {
                const cat = listingCategory(l.category)
                return (
                  <Link key={l.id} href={`/board/${l.id}`} className="group card p-5 hover:-translate-y-1 transition-transform duration-300">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600"><span aria-hidden="true">{cat.emoji} </span>{cat.label}{l.neighborhood ? ` · ${l.neighborhood}` : ''}</span>
                      {l.price && <span className="text-sm font-bold text-gray-900 shrink-0">{l.price}</span>}
                    </div>
                    <h3 className="font-bold text-gray-900 group-hover:text-amber-600 transition-colors line-clamp-2">{l.title}</h3>
                    <p className="text-sm text-gray-600 mt-1.5 line-clamp-3">{l.description}</p>
                    <p className="text-xs text-gray-400 mt-3">{l.user?.name ?? 'Smileys member'} · {new Date(l.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                  </Link>
                )
              })}
            </div>
          )}
          <div className="mt-10 text-center">
            <a href={enter('board')} className="btn-secondary text-base px-8 py-4">
              {total > listings.length
                ? `See all ${total} posts`
                : isDefault ? 'Open the board with filters' : `Open the ${city.name} board with filters`}
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
