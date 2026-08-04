import { headers } from 'next/headers'
import { APP_URL, SITE_URL } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { resolveImageUrl } from '@/lib/data'

// See app/about/page.tsx — a page-level `openGraph` block loses the root
// layout's default og:image, so this shared with no preview at all on
// WhatsApp/iMessage/Twitter until this was added.
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Clubs in Istanbul',
  eyebrow: 'Smileys Community',
  cta:     'Browse clubs',
}).toString()}`

export const metadata = {
  alternates: { canonical: `${APP_URL}/clubs` },
  title: 'Clubs in Istanbul — Smileys Community',
  description: 'Join interest-based clubs in Istanbul — hiking, photography, French conversation, sailing, book clubs and more. Find your people at Smileys.',
  openGraph: {
    title: 'Istanbul Social Clubs — Smileys Community',
    description: 'Over 70 interest-based clubs in Istanbul. Find your community at Smileys.',
    url: `${APP_URL}/clubs`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Istanbul Social Clubs — Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Istanbul Social Clubs — Smileys Community',
    description: 'Over 70 interest-based clubs in Istanbul. Find your community at Smileys.',
    images: [ogImage],
  },
}

// Same script-tag escaping used by every other JSON-LD block in the app.
function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

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
  const clubs = await prisma.club.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { name: true, slug: true, description: true, coverImage: true },
  })
  const nonce = (await headers()).get('x-nonce') ?? undefined
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
