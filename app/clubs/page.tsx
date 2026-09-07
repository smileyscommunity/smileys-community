import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { jsonLdHtml } from '@/lib/jsonLd'
import { APP_URL, SITE_URL } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveCityForPage } from '@/lib/cityPageParam'
import { shareCover } from '@/lib/shareCover'
import { resolveImageUrl } from '@/lib/data'
import ClubsClient from './ClubsClient'

// Server wrapper around the clubs grid (./ClubsClient). It resolves the
// city, owns the page's metadata and emits the grid as structured data; the
// client tree can't export metadata, and the layout this used to live in got
// no searchParams. clubs/[slug] sets its own, so nothing here reaches the
// detail pages.
//
// Which city: ?city= when the URL carries one, else the view-city cookie →
// member's home city → default (lib/cityPageParam). A link-preview crawler
// has neither session nor cookie, so without the param every share of
// /clubs previewed as the default city's — name and card — whatever city
// the sharer had on screen. The client passes the same ?city= to
// GET /api/clubs and /api/city/current, so grid, heading and this metadata
// agree.

type Search = Record<string, string | string[] | undefined>
interface Props { searchParams?: Promise<Search> }

// Names the city whose clubs you're actually being shown. The DEFAULT city
// keeps its exact indexed strings — this page is indexed under "clubs in
// Istanbul", and rewording a title Google already has costs something for
// nothing.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { city } = await resolveCityForPage(searchParams)
  const name      = city.name
  const isDefault = city.slug === DEFAULT_CITY_SLUG
  const title     = `Clubs in ${name} — Smileys Community`
  const desc      = isDefault
    ? 'Join interest-based clubs in Istanbul — hiking, photography, French conversation, sailing, book clubs and more. Find your people at Smileys.'
    : `Join interest-based clubs in ${name} — hiking, photography, language conversation, book clubs and more. Find your people at Smileys.`
  const ogDesc    = isDefault
    ? "Whatever you're into, there's probably someone in Istanbul who's into it too."
    : `Whatever you're into, there's probably someone in ${name} who's into it too.`
  // Canonical rule from app/[city]/data.ts: another city's grid is canonical
  // at its crawlable hub (/[city]/clubs); the default city's stays here.
  // og:url follows the canonical.
  const canonical = isDefault ? `${APP_URL}/clubs` : `${APP_URL}/${city.slug}/clubs`
  // The city's own cover or hero photo; the branded square card only when it
  // has neither (lib/shareCover).
  const image = shareCover('clubs', city, 'Smileys Clubs — do more, meet more, live more')

  return {
    alternates: { canonical },
    title,
    description: desc,
    openGraph: {
      title: 'Smileys Clubs — Find your people.',
      description: ogDesc,
      url: canonical,
      images: [image],
    },
    twitter: {
      card: image.twitterCard,
      title: 'Smileys Clubs — Find your people.',
      description: ogDesc,
      images: [image.url],
    },
  }
}

function absoluteImageUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const resolved = resolveImageUrl(path)
  if (!resolved) return undefined
  return resolved.startsWith('http') ? resolved : `${SITE_URL}${resolved}`
}

export default async function ClubsPage({ searchParams }: Props) {
  const { city, cityId, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the address
  // bar they copy is a link that survives being shared. Guarded on `pinned` so
  // this can't loop, and skipped for the default city to leave its established
  // bare URL alone. The filters the URL already carries (?tab=, ?category=)
  // come along.
  if (!pinned && city.slug !== DEFAULT_CITY_SLUG) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      if (key === 'city' || value === undefined) continue
      for (const one of Array.isArray(value) ? value : [value]) qs.append(key, one)
    }
    qs.set('city', city.slug)
    redirect(`/clubs?${qs}`)
  }

  // The grid is client-rendered, so the structured data is emitted here for
  // the city the page resolved to — it used to name the default city only,
  // from before the per-city hubs existed. isActive:true matches getClubs()'s
  // public-surface gate; private clubs are still included since they're still
  // visible in the grid (just gated on Join → Request).
  const clubs = await prisma.club.findMany({
    where: { isActive: true, cityId },
    orderBy: { name: 'asc' },
    select: { name: true, slug: true, description: true, coverImage: true },
  })
  const clubsJsonLd = {
    '@context': 'https://schema.org',
    '@type':    'ItemList',
    itemListElement: clubs.map((c, i) => ({
      '@type':  'ListItem',
      position: i + 1,
      item: {
        '@type':      'Organization',
        name:         c.name,
        description:  c.description?.slice(0, 300) || undefined,
        url:          `${APP_URL}/clubs/${c.slug}`,
        image:        absoluteImageUrl(c.coverImage),
      },
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(clubsJsonLd) }}
      />
      <ClubsClient />
    </>
  )
}
