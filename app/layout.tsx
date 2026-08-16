import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { Toaster } from 'sonner'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import VerifyEmailBanner from '@/components/VerifyEmailBanner'
import PendingApprovalBanner from '@/components/PendingApprovalBanner'
import { AuthProvider } from '@/contexts/AuthContext'
import BottomNav from '@/components/BottomNav'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import ClientOnlyComponents from '@/components/ClientOnlyComponents'
import { BRAND_AMBER } from '@/lib/constants'

import { APP_URL } from '@/lib/env'
import { loadContent } from '@/lib/content'
import { resolveStats } from '@/lib/communityStats'
import { getNavCities } from '@/lib/cities'
import { getViewCityId, resolveCityId } from '@/lib/city'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

const siteUrl = APP_URL
const defaultImage = `${siteUrl}/api/og`

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Smileys Community — The Social Life Platform of Istanbul',
  description: `Join Istanbul's most vibrant social community. Discover events, join clubs, and meet amazing people.`,
  // Google Search Console verification (URL-prefix property for /app). Renders
  // <meta name="google-site-verification" ...> on every page.
  verification: { google: '213P-rY3PKV2WP2lkdeg8RcPgbUsXHF5G7xfR6yzODM' },
  appleWebApp: {
    capable: true,
    title: 'Smileys',
    statusBarStyle: 'default',
  },
  openGraph: {
    // Site-wide fallback for any page that doesn't set its own. It named
    // Istanbul, so every unshared-elsewhere link previewed as an Istanbul-only
    // community — including the global landing page, now that three cities are
    // live.
    title: 'Smileys Community',
    description: 'Meet people, join clubs and discover experiences. A network of local communities, growing city by city.',
    url: siteUrl,
    siteName: 'Smileys Community',
    images: [{ url: defaultImage, width: 1200, height: 630, alt: 'Smileys Community' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Smileys Community',
    description: 'Meet people, join clubs and discover experiences. A network of local communities, growing city by city.',
    images: [defaultImage],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: BRAND_AMBER,
}

// `headers()` call below forces every page in the app to be dynamically
// rendered. This is required for the nonce-based CSP set by middleware.ts
// to work — static pages would pre-render the HTML at build time with
// no nonce on the inline <script> tags, and modern browsers would block
// them under `'strict-dynamic'`. The trade-off is per-request rendering
// cost, but the app is mostly authenticated/data-driven so the static
// rendering savings were already small.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Also captures the nonce for the sitewide Organization JSON-LD below.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  // Admin override wins; otherwise the footer shows measured numbers rather
  // than a hard-coded figure that drifts (see lib/communityStats).
  const footerStats = await resolveStats(loadContent().stats)
  // Server-rendered so Cities is in the HTML rather than appearing after
  // hydration: it's a first-class nav item, and crawlers need to find the city
  // pages through it.
  const navCities = await getNavCities()

  // Home vs viewing city, for the member city selector and the footer's
  // city-scoped column. Resolved the same way the feeds are, so the footer
  // heading can never disagree with the links under it.
  const session      = await getSession()
  const viewCityId   = await getViewCityId()
  const footerCityId = await resolveCityId(session)
  const cityIds      = [...new Set([session?.cityId, viewCityId, footerCityId].filter(Boolean) as string[])]
  const cityRows     = cityIds.length
    ? await prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, slug: true, name: true } })
    : []
  const homeSlug       = cityRows.find(c => c.id === session?.cityId)?.slug
  const viewingSlug    = cityRows.find(c => c.id === viewCityId)?.slug
  const footerCityName = cityRows.find(c => c.id === footerCityId)?.name ?? 'Istanbul'
  // Only Istanbul has neighbourhoods today. Rather than link every city to a
  // page that would be empty, the entry appears when the city has rows.
  const hasNeighborhoods = (await prisma.neighborhood.count({
    where: { cityId: footerCityId, active: true },
  })) > 0
  // Sitewide Organization schema — feeds Google's brand/knowledge-panel
  // signals. Not LocalBusiness: Smileys has no single storefront, events run
  // across venues city-wide. sameAs mirrors the social links in Footer.tsx.
  const organizationJsonLd = {
    '@context':   'https://schema.org',
    '@type':      'Organization',
    name:         'Smileys Community',
    url:          siteUrl,
    logo:         `${siteUrl}/icons/icon-512.png`,
    description:  'The social infrastructure for modern international life — curated city communities with events, clubs, and genuine connections for expats, nomads, travelers, and locals.',
    // Istanbul is the founding (and first live) city; add each city here as
    // it goes live. Kept static rather than DB-driven: the root layout wraps
    // every page and must not gain a query for a rarely-changing list.
    areaServed:   [{ '@type': 'City', name: 'Istanbul' }],
    sameAs: [
      'https://www.instagram.com/smileys.community',
      'https://linkedin.com/company/smileys-community',
      'https://www.facebook.com/aswistanbul/',
      'https://www.whatsapp.com/channel/0029VaCKyc29hXF4fZuOod1K',
    ],
  }
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="manifest" href="/manifest.json" />
        <script
          type="application/ld+json"
          nonce={nonce}
          // Same escaping guard as the per-page JSON-LD blocks (handbook
          // article, event detail, FAQ): `<` must be escaped or a literal
          // `</script><script>` in an interpolated value would break out of
          // this tag. Nothing here is user-controlled, kept for consistency.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd)
              .replace(/</g, '\\u003c')
              .replace(/\u2028/g, '\\u2028')
              .replace(/\u2029/g, '\\u2029'),
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col bg-white">
        <AuthProvider>
          <Navbar cities={navCities} homeSlug={homeSlug} viewingSlug={viewingSlug} />
          <VerifyEmailBanner />
          <PendingApprovalBanner />
          <main className="flex-1">{children}</main>
          <BottomNav />
          <Footer stats={footerStats} cityName={footerCityName} hasNeighborhoods={hasNeighborhoods} />
          <ClientOnlyComponents />
          <Toaster position="top-right" richColors closeButton />
        </AuthProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}
