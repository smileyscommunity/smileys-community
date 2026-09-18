import type { Metadata } from 'next'
import { shareCover } from '@/lib/shareCover'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getPublicCity } from '@/lib/cities'
import { CITY_STATUS } from '@/lib/cityStatus'
import { APP_URL } from '@/lib/env'
import { BOARD_POST_TYPES } from '@/lib/board'
import { redactBoardTextForGuest, blockedPairIds } from '@/lib/boardAccess'
import { getCityBoardHub, enterLinkFor, hubCanonical, isDefaultCitySlug } from '../data'

// /[city]/board — the crawlable list of a city's community board: its
// questions, recommendations and community posts. The global /board is the
// interactive hub (client-rendered, scoped by the view-city cookie); this is
// the fixed-city page. It listed marketplace listings from before the board
// and the marketplace split. The loader selects public fields only; guests
// additionally get the board's text redaction (no invite links, numbers or
// emails — lib/boardAccess). Canonical rule in ../data.ts.

const TYPE_META = Object.fromEntries(BOARD_POST_TYPES.map(t => [t.value, t]))

interface Params { params: Promise<{ city: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city || city.status !== CITY_STATUS.Live) return {}
  const title = `${city.name} Community Board — Smileys Community`
  const description = `Questions, recommendations and local news from the Smileys community in ${city.name} — ask, share, connect.`
  // The city's own cover or hero photo, never the default city's cover under
  // this city's name (lib/shareCover).
  const image = shareCover('board', city, title)
  return {
    title, description,
    alternates: { canonical: hubCanonical(city.slug, 'board') },
    openGraph: {
      title, description, url: `${APP_URL}/${city.slug}/board`, siteName: 'Smileys Community', type: 'website',
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  }
}

export default async function CityBoardPage({ params }: Params) {
  const { city: slug } = await params
  const city = await getPublicCity(slug)
  if (!city) notFound()
  if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)

  const { posts: cached, total } = await getCityBoardHub(city.id)
  // Per request, outside the cache: a guest reads the text with contact
  // details cut out, and a blocked pair doesn't see each other.
  const session = await getSession()
  const blocked = new Set(await blockedPairIds(session?.id ?? null))
  const posts = cached
    .filter(p => !blocked.has(p.userId))
    .map(p => ({
      ...p,
      title: session ? p.title : redactBoardTextForGuest(p.title),
      body:  session ? p.body  : redactBoardTextForGuest(p.body),
      author: session ? p.author : 'Smileys member',
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
              ? `Questions, recommendations and local news from members in ${city.name} — the first posts come from the first members.`
              : `${total} conversation${total === 1 ? '' : 's'} — questions, recommendations and local news, from members.`}
          </p>
          <Link href={`/marketplace?city=${city.slug}`} className="inline-block mt-4 text-sm font-semibold text-amber-700 hover:text-amber-800">
            Rooms, jobs and things for sale are in the {city.name} marketplace →
          </Link>
        </div>
      </section>

      <section className="py-10 sm:py-14 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {posts.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-white p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">Nothing posted yet</h2>
              <p className="text-gray-600 max-w-xl mx-auto">The board fills up as members arrive. Join Smileys {city.name} and ask the first question.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {posts.map(p => {
                const meta = TYPE_META[p.type] ?? TYPE_META.share
                return (
                  <Link key={p.id} href={`/board?post=${p.id}&city=${city.slug}`} className="group card p-5 hover:-translate-y-1 transition-transform duration-300">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600 block mb-2">
                      <span aria-hidden="true">{meta.emoji} </span>{meta.label}{p.neighborhood ? ` · ${p.neighborhood}` : ''}
                    </span>
                    <h3 className="font-bold text-gray-900 group-hover:text-amber-600 transition-colors line-clamp-2">{p.title}</h3>
                    {p.body && <p className="text-sm text-gray-600 mt-1.5 line-clamp-3">{p.body}</p>}
                    <p className="text-xs text-gray-400 mt-3">
                      {p.author} · {new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {p.replies > 0 && <> · 💬 {p.replies}</>}
                    </p>
                  </Link>
                )
              })}
            </div>
          )}
          <div className="mt-10 text-center">
            <a href={enter('board')} className="btn-secondary text-base px-8 py-4">
              {total > posts.length
                ? `See all ${total} posts`
                : isDefault ? 'Open the board with filters' : `Open the ${city.name} board with filters`}
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
