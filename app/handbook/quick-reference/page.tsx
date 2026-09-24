import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import TransitLinks from '@/components/TransitLinks'
import { resolveCityForPage, type CitySearch } from '@/lib/cityPageParam'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { APP_URL } from '@/lib/env'
import { loadQuickReference } from '@/lib/quickReference'

// /handbook/quick-reference — the apps, official sites and practical links
// that used to fill the bottom of the Handbook index. There it was 64% of
// the page (8,200px of text cards after the page's own closing CTA), and
// it isn't the Handbook's kind of content: short, unsourced tips beside
// articles that cite official sources. It keeps its own page, one link away.
//
// DEFAULT CITY ONLY, the rule it had on the index: data/city-guide.json is
// Istanbul's link pack (server-authoritative, edited in /admin's guide
// editor), so any other city is sent back to its Handbook.

type Props = { searchParams?: Promise<CitySearch> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { city } = await resolveCityForPage(searchParams)
  return {
    title:       `Quick reference — ${city.name} Handbook | Smileys Community`,
    description: `Apps, official sites and practical links for day-to-day life in ${city.name}.`,
    alternates:  { canonical: `${APP_URL}/handbook/quick-reference` },
  }
}

export default async function QuickReferencePage({ searchParams }: Props) {
  const { city } = await resolveCityForPage(searchParams)
  if (city.slug !== DEFAULT_CITY_SLUG) redirect(`/handbook?city=${city.slug}`)
  const categories = loadQuickReference()
  if (categories.length === 0) redirect('/handbook')

  return (
    <main className="bg-white">
      <section className="border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12"><div className="max-w-3xl">
          <Link href="/handbook" className="text-xs text-amber-600 font-semibold hover:underline">← The {city.name} Handbook</Link>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 mt-4">Quick reference</h1>
          <p className="text-gray-600 mt-2 leading-relaxed">
            Apps, official sites and practical links for day-to-day life in {city.name}.
          </p>
          {/* Said up front, because the cards carry prices and hours with no
              source or date — unlike the Handbook articles they sit beside. */}
          <p className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 leading-relaxed">
            These are quick tips from the Smileys team, not checked guides. Prices and opening hours are rough
            and date quickly — confirm them with the provider. For the full, sourced version of a topic, read the{' '}
            <Link href="/handbook" className="font-semibold text-amber-700 hover:underline">Handbook articles</Link>.
          </p>
        </div></div>
      </section>
      <section>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-3xl">
            <TransitLinks categories={categories} />
          </div>
        </div>
      </section>
    </main>
  )
}
