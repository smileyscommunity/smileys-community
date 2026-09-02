import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'
import { resolveImageUrl } from '@/lib/data'
import ExploreMore from '@/components/ExploreMore'
import { getCityDirectoryHub, enterLinkFor, hubCanonical, isDefaultCitySlug } from '../data'

// /[city]/directory — the crawlable list of a city's member-recommended
// places. The global /directory is the interactive browser (client-rendered,
// scoped by the view-city cookie); this is the fixed-city page a search
// engine can read. Canonical rule in ../data.ts.

interface Params { params: Promise<{ city: string }> }

const ogImage = `${APP_URL}/images/directory-cover.jpg`

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title = `${city.name} Directory — Smileys Community`
  const description = `Member-recommended businesses, services and places across ${city.name} — cafés, doctors, gyms and more, vouched for by the Smileys community.`
  return {
    title, description,
    alternates: { canonical: hubCanonical(city.slug, 'directory') },
    openGraph: {
      title, description, url: `${APP_URL}/${city.slug}/directory`, siteName: 'Smileys Community', type: 'website',
      images: [{ url: ogImage, secureUrl: ogImage, width: 1200, height: 800, alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  }
}

export default async function CityDirectoryPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const { items, total } = await getCityDirectoryHub(city.id)
  const enter = enterLinkFor(city.slug)
  const isDefault = isDefaultCitySlug(city.slug)

  return (
    <div className="bg-warm pb-20 md:pb-0">
      <section className="bg-gradient-to-b from-amber-50 via-white to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
          <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
            <span aria-hidden="true">←</span> Smileys {city.name}
          </Link>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-3">
            The <span className="text-amber-600">{city.name}</span> directory
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            {total === 0
              ? `Places in ${city.name} that members vouch for — the first recommendations come from the first members.`
              : `${total} place${total === 1 ? '' : 's'} members vouch for — cafés, doctors, gyms, coworking and more.`}
          </p>
        </div>
      </section>

      <section className="py-10 sm:py-14 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {items.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-white p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">Nothing listed yet</h2>
              <p className="text-gray-600 max-w-xl mx-auto">Members add the places they trust. The first recommendations in {city.name} are on their way.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {items.map(b => {
                const cover = resolveImageUrl(b.coverImage ?? b.logo)
                return (
                  <Link key={b.id} href={`/directory/${b.id}`} className="group card overflow-hidden hover:-translate-y-1 transition-transform duration-300">
                    <div className="relative aspect-[16/10] bg-amber-50">
                      {cover
                        ? <Image src={cover} alt={b.name} fill sizes="(min-width: 1280px) 280px, (min-width: 640px) 45vw, 100vw" className="object-cover" />
                        : <div className="absolute inset-0 flex items-center justify-center text-4xl" aria-hidden="true">🏙️</div>}
                      {(b.isExpatOwned || b.isExpatFriendly) && (
                        <span className="absolute top-2 left-2 bg-white/90 text-gray-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {b.isExpatOwned ? 'Expat-owned' : 'Expat-friendly'}
                        </span>
                      )}
                    </div>
                    <div className="p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600">{b.category}{b.neighborhood ? ` · ${b.neighborhood}` : ''}</p>
                      <h3 className="font-bold text-gray-900 mt-1 group-hover:text-amber-600 transition-colors line-clamp-1">{b.name}</h3>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{b.description}</p>
                      <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
                        {b.avgRating != null && b.reviewCount > 0 && (
                          <span><span aria-hidden="true">⭐ </span>{b.avgRating.toFixed(1)} · {b.reviewCount} review{b.reviewCount === 1 ? '' : 's'}</span>
                        )}
                        {b.memberDiscount && <span className="text-fuchsia-600 font-semibold truncate"><span aria-hidden="true">💸 </span>{b.memberDiscount}</span>}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
          <div className="mt-10 text-center">
            <a href={enter('directory')} className="btn-secondary text-base px-8 py-4">
              {total > items.length
                ? `See all ${total} places`
                : isDefault ? 'Browse the directory with filters and a map' : `Browse the ${city.name} directory with filters and a map`}
            </a>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <ExploreMore current="directory" cityId={city.id} cityName={city.name} />
      </div>
    </div>
  )
}
