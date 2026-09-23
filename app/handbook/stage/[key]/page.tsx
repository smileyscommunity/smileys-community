import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { resolveCityForPage, type CitySearch } from '@/lib/cityPageParam'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { APP_URL } from '@/lib/env'
import { categoryMeta } from '@/lib/handbook-categories'
import { reviewLabel } from '@/lib/handbook-review'
import { getCityHandbookIndex } from '@/lib/handbookIndex'
import { lifeStage, articlesForStage, includesHighStakes } from '@/lib/relocation'

// /handbook/stage/<key> — the Handbook read by where you are in a move
// (planning, just arrived, settling in, urgent help) instead of by topic.
// A view over existing articles, never a collection of its own: the stage's
// categories come from lib/relocation, the articles from the city's Handbook.
// A stage with nothing in this city 404s rather than render an empty shelf,
// and the Handbook index only links the stages that have articles.
//
// City from ?city= (the Handbook's rule, lib/cityPageParam); the default city
// keeps the bare URL as canonical, every other city its ?city= form.

type Props = { params: Promise<{ key: string }>; searchParams?: Promise<CitySearch> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { key } = await params
  const stage = lifeStage(key)
  if (!stage) return {}
  const { city } = await resolveCityForPage(searchParams)
  const qs = city.slug === DEFAULT_CITY_SLUG ? '' : `?city=${city.slug}`
  return {
    title:       `${stage.label} — ${city.name} Handbook | Smileys Community`,
    description: stage.blurb,
    alternates:  { canonical: `${APP_URL}/handbook/stage/${stage.key}${qs}` },
  }
}

export default async function HandbookStagePage({ params, searchParams }: Props) {
  const { key } = await params
  const stage = lifeStage(key)
  if (!stage) notFound()

  const { city, cityId } = await resolveCityForPage(searchParams)
  const articles = articlesForStage(stage, await getCityHandbookIndex(cityId, city.country ?? null), cityId)
  if (articles.length === 0) notFound()
  const handbookHref = city.slug === DEFAULT_CITY_SLUG ? '/handbook' : `/handbook?city=${city.slug}`

  return (
    <main className="bg-gray-50 min-h-screen">
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12"><div className="max-w-3xl">
          <Link href={handbookHref} className="text-xs text-amber-600 font-semibold hover:underline">← The {city.name} Handbook</Link>
          <div className="flex items-center gap-3 mt-4 mb-3">
            <span aria-hidden="true" className="text-4xl">{stage.emoji}</span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 leading-tight">{stage.label}</h1>
          </div>
          <p className="text-sm text-gray-600 max-w-xl leading-relaxed">{stage.blurb}</p>
        </div></div>
      </section>

      <section>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10"><div className="max-w-3xl space-y-3">
          {/* One note for the page, not one per article: the high-stakes
              articles carry their own "rules change" banner too. */}
          {includesHighStakes(articles) && (
            <p className="flex gap-2 rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-700 leading-relaxed">
              <span aria-hidden="true">⚠️</span>
              <span>
                <span className="font-bold text-gray-900">Member-written, not professional advice.</span>{' '}
                These guides explain how things work in practice; they are not legal, immigration, tax or
                medical advice. Where a guide links official sources, those set the current requirements.
              </span>
            </p>
          )}
          {articles.map(a => {
            const meta = categoryMeta(a.category)
            const reviewed = reviewLabel(a)
            return (
              <Link key={a.slug} href={`/handbook/${a.slug}`}
                className="block bg-white rounded-2xl border border-gray-200 p-6 hover:border-amber-300 hover:shadow-sm hover:-translate-y-0.5 transition-all group">
                <p className="text-xs text-gray-600 mb-2">
                  <span aria-hidden="true">{meta?.emoji ?? '📖'} </span>{meta?.label ?? a.category}
                </p>
                <h2 className="text-lg sm:text-xl font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors leading-tight">
                  {a.title}
                </h2>
                {a.excerpt && <p className="text-sm text-gray-600 mt-2 leading-relaxed line-clamp-2">{a.excerpt}</p>}
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-3">
                  <span className="text-gray-500">Member-written guide</span>
                  {a.hasOfficialSources && <span className="font-semibold text-gray-700">Links official sources</span>}
                  {reviewed && <span className={reviewed.stale ? 'text-gray-500' : 'font-semibold text-emerald-700'}>{reviewed.stale ? 'Review overdue' : reviewed.text}</span>}
                </p>
              </Link>
            )
          })}
        </div></div>
      </section>
    </main>
  )
}
