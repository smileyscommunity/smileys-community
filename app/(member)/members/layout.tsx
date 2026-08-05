import type { Metadata } from 'next'
import { APP_URL } from '@/lib/env'

// The members page itself is a client component, so its metadata lives
// here (same pattern as app/clubs/layout.tsx and app/guide/layout.tsx).
//
// Members is a signed-in surface: noindex, like the individual profile
// pages. The OG card still matters — members share this link in group
// chats, and without it the preview falls back to the generic brand
// card. Square 1200x1200 (~286KB, under WhatsApp's ~300KB silent-drop
// cap) with twitter card 'summary' so it renders uncropped.
//
// Note: the card's people are illustrative brand artwork. Per the
// Members brief §54, generated faces must never stand in for real
// members ON the page — the page itself renders actual member photos.
const ogImage = `${APP_URL}/images/members-og.jpg`

const title = 'Smileys Members — Meet the community.'
const description = 'Discover people through the neighborhoods, interests and experiences you share.'

export const metadata: Metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  alternates: { canonical: `${APP_URL}/members` },
  openGraph: {
    title,
    description,
    url: `${APP_URL}/members`,
    siteName: 'Smileys Community',
    images: [{ url: ogImage, width: 1200, height: 1200, alt: 'Smileys Members — real people, real connections, real life' }],
  },
  twitter: {
    card: 'summary',
    title,
    description,
    images: [ogImage],
  },
}

export default function MembersLayout({ children }: { children: React.ReactNode }) {
  return children
}
