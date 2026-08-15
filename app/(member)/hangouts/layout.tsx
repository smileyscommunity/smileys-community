import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_URL } from '@/lib/env'

// Share metadata for the hangouts section. The list page is a client
// component (can't export metadata itself), so this pass-through server
// layout carries the link-preview image — a collage of member hangouts.
// Individual hangout permalinks ([id]) override with their own photo
// via generateMetadata.
const ogImage = `${APP_URL}/images/og-hangouts.jpg`

export const metadata: Metadata = {
  title: 'Hangouts — Smileys Community',
  description: 'Spontaneous member-made meetups — coffee, sports, walks, picnics, and more. See who wants to hang out today.',
  openGraph: {
    title: 'Hangouts — Smileys Community',
    description: 'Spontaneous member-made meetups — coffee, sports, walks, picnics, and more.',
    images: [{ url: ogImage, width: 1200, height: 800, alt: 'Smileys members hanging out' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hangouts — Smileys Community',
    description: 'Spontaneous member-made meetups — coffee, sports, walks, picnics, and more.',
    images: [ogImage],
  },
}

export default function HangoutsLayout({ children }: { children: ReactNode }) {
  return children
}
