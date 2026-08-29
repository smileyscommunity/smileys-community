import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { jsonLdHtml } from '@/lib/jsonLd'
import { APP_URL, SITE_URL } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { getDefaultCityId, resolveCityId, getCityConfig, DEFAULT_CITY_SLUG } from '@/lib/city'
import { resolveImageUrl } from '@/lib/data'

// See app/about/page.tsx — a page-level `openGraph` block loses the root
// layout's default og:image, so this shared with no preview at all on
// WhatsApp/iMessage/Twitter until this was added. Now the branded clubs
// card (1200x1200, ~290KB — under WhatsApp's ~300KB silent-drop cap).
// Square by design: it doubles as the Instagram asset, and the square
// twitter 'summary' card renders it uncropped where 'summary_large_image'
// would letterbox it.
const ogImage = `${APP_URL}/images/clubs-og.jpg`

// Names the city whose clubs you're actually being shown (same pattern as
// app/directory/layout.tsx): the clubs grid scopes per city, so an Izmir
// member browsing here shouldn't do it under a title reading "in Istanbul".
//
// The DEFAULT city keeps its exact indexed strings — this page is indexed
// under "clubs in Istanbul", and rewording a title Google already has costs
// something for nothing. Crawlers carry no cookie, so they resolve to the
// default city and see precisely what they see today. (The JSON-LD below
// deliberately stays default-city — see the comment in ClubsLayout.)
export async function generateMetadata(): Promise<Metadata> {
  const cfg       = await getCityConfig(await resolveCityId(await getSession()))
  const name      = cfg.name
  const isDefault = cfg.slug === DEFAULT_CITY_SLUG
  const title     = `Clubs in ${name} — Smileys Community`
  const desc      = isDefault
    ? 'Join interest-based clubs in Istanbul — hiking, photography, French conversation, sailing, book clubs and more. Find your people at Smileys.'
    : `Join interest-based clubs in ${name} — hiking, photography, language conversation, book clubs and more. Find your people at Smileys.`
  const ogDesc    = isDefault
    ? "Whatever you're into, there's probably someone in Istanbul who's into it too."
    : `Whatever you're into, there's probably someone in ${name} who's into it too.`

  return {
    alternates: { canonical: `${APP_URL}/clubs` },
    title,
    description: desc,
    openGraph: {
      title: 'Smileys Clubs — Find your people.',
      description: ogDesc,
      url: `${APP_URL}/clubs`,
      images: [{ url: ogImage, width: 1200, height: 1200, alt: 'Smileys Clubs — do more, meet more, live more' }],
    },
    twitter: {
      card: 'summary',
      title: 'Smileys Clubs — Find your people.',
      description: ogDesc,
      images: [ogImage],
    },
  }
}

// Same script-tag escaping used by every other JSON-LD block in the app.

function absoluteImageUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const resolved = resolveImageUrl(path)
  if (!resolved) return undefined
  return resolved.startsWith('http') ? resolved : `${SITE_URL}${resolved}`
}

export default async function ClubsLayout({ children }: { children: React.ReactNode }) {
  // The clubs grid itself is a client component (page.tsx fetches via
  // useEffect), so — same as /board and /marketplace — the JSON-LD lives
  // here in the sibling server layout instead. isActive:true matches
  // getClubs()'s public-surface gate; private clubs are still included
  // since they're still visible in the grid (just gated on Join → Request).
  // headers() first: it opts the layout out of build-time prerender, so
  // getDefaultCityId() below can never run against a build DB missing the
  // istanbul row (fresh clone / CI) and fail the build.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const clubs = await prisma.club.findMany({
    // Default city: this layout renders the public (guest-facing) grid,
    // whose SEO surface stays the flagship city until per-city pages ship.
    where: { isActive: true, cityId: await getDefaultCityId() },
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
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(clubsJsonLd) }}
      />
      {children}
    </>
  )
}
