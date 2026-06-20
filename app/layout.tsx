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

import { APP_URL } from '@/lib/env'
import { loadContent } from '@/lib/content'

const siteUrl = APP_URL
const defaultImage = `${siteUrl}/api/og`

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Smileys Community — The Social Life Platform of Istanbul',
  description: `Join Istanbul's most vibrant social community. Discover events, join clubs, and meet amazing people.`,
  appleWebApp: {
    capable: true,
    title: 'Smileys',
    statusBarStyle: 'default',
  },
  openGraph: {
    title: 'Smileys Community — Istanbul',
    description: `Join Istanbul's most vibrant social community. Discover events, join clubs, and meet amazing people.`,
    url: siteUrl,
    siteName: 'Smileys Community',
    images: [{ url: defaultImage, width: 1200, height: 630, alt: 'Smileys Community' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Smileys Community — Istanbul',
    description: `Join Istanbul's most vibrant social community. Discover events, join clubs, and meet amazing people.`,
    images: [defaultImage],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f59e0b',
}

// `headers()` call below forces every page in the app to be dynamically
// rendered. This is required for the nonce-based CSP set by middleware.ts
// to work — static pages would pre-render the HTML at build time with
// no nonce on the inline <script> tags, and modern browsers would block
// them under `'strict-dynamic'`. The trade-off is per-request rendering
// cost, but the app is mostly authenticated/data-driven so the static
// rendering savings were already small.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers()
  const footerStats = loadContent().stats
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="min-h-screen flex flex-col bg-white">
        <AuthProvider>
          <Navbar />
          <VerifyEmailBanner />
          <PendingApprovalBanner />
          <main className="flex-1">{children}</main>
          <BottomNav />
          <Footer stats={footerStats} />
          <ClientOnlyComponents />
          <Toaster position="top-right" richColors closeButton />
        </AuthProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}
