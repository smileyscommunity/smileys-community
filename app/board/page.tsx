import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { APP_URL } from '@/lib/env'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveCityForPage } from '@/lib/cityPageParam'
import { shareCover } from '@/lib/shareCover'
import BoardClient from './BoardClient'

// Server wrapper around the community board (./BoardClient). It resolves the
// city and owns the page's metadata; the client tree can't export any, and
// the layout this used to live in gets no searchParams. board/[id] sets its
// own metadata, so nothing here reaches the detail pages.
//
// Which city: ?city= when the URL carries one, else the view-city cookie →
// member's home city → default (lib/cityPageParam). A link-preview crawler
// has neither session nor cookie, so without the param every share of
// /board previewed as the default city's — name and cover — whatever city
// the sharer had on screen. The client passes the same ?city= to
// GET /api/board, /api/neighborhoods and /api/city/current, so feed, filter,
// heading and this metadata agree.

type Search = Record<string, string | string[] | undefined>
interface Props { searchParams?: Promise<Search> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { city } = await resolveCityForPage(searchParams)
  const isDefault = city.slug === DEFAULT_CITY_SLUG
  const desc  = `Plans, questions and recommendations from the Smileys community in ${city.name} — ask, share, connect.`
  const title = 'Community Board — Smileys Community'
  // Canonical rule from app/[city]/data.ts: another city's board is canonical
  // at its crawlable hub (/[city]/board); the default city's stays here.
  // og:url follows the canonical.
  const canonical = isDefault ? `${APP_URL}/board` : `${APP_URL}/${city.slug}/board`
  // The city's own cover or hero photo, never the default city's cover under
  // this city's name (lib/shareCover).
  const image = shareCover('board', city, title)

  return {
    alternates: { canonical },
    title,
    description: desc,
    openGraph: {
      title, description: desc,
      url: canonical,
      siteName: 'Smileys Community',
      type: 'website',
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title, description: desc,
      images: [image.url],
    },
  }
}

export default async function BoardPage({ searchParams }: Props) {
  const { city, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the address
  // bar they copy is a link that survives being shared. Guarded on `pinned` so
  // this can't loop, and skipped for the default city to leave its established
  // bare URL alone. The filters and deep links the URL already carries
  // (?post=, ?neighborhood=, ?compose=, …) come along.
  if (!pinned && city.slug !== DEFAULT_CITY_SLUG) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      if (key === 'city' || value === undefined) continue
      for (const one of Array.isArray(value) ? value : [value]) qs.append(key, one)
    }
    qs.set('city', city.slug)
    redirect(`/board?${qs}`)
  }

  return <BoardClient />
}
