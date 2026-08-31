import type { Metadata } from 'next'
import { APP_URL, SITE_URL } from '@/lib/env'

// Open Graph + Twitter card metadata for /cup. The cup banner SVG
// doubles as the share image since it carries the title, dates, and
// tagline — drop it into WhatsApp/iMessage/X and the preview reads
// instantly. Without this, a shared /cup link rendered a blank
// preview, which kills the organic-spread vector the page depends
// on for visitor conversion.
//
// Lives in a layout because the page itself is a client component
// (`'use client'`) and can't export metadata directly.

// Tournament wrapped Jul 19, 2026 — the page now serves as the archive of
// the final standings, so the share copy reads past-tense instead of
// inviting predictions for a competition that's over.
const TITLE       = 'Smileys World Cup 2026 — final standings'
const DESCRIPTION = 'How the community predicted World Cup 2026 — every pick, every knockout, and the final leaderboard. Jun 11 → Jul 19, 2026.'
const IMAGE_URL   = `${SITE_URL}/app/images/cup-banner.svg`

export const metadata: Metadata = {
  title:       TITLE,
  description: DESCRIPTION,
  openGraph: {
    title:       TITLE,
    description: DESCRIPTION,
    url:         `${APP_URL}/cup`,
    siteName:    'Smileys Community',
    images:      [{ url: IMAGE_URL, secureUrl: IMAGE_URL, width: 800, height: 320, alt: 'Smileys Cup 2026' }],
    type:        'website',
  },
  twitter: {
    card:        'summary_large_image',
    title:       TITLE,
    description: DESCRIPTION,
    images:      [IMAGE_URL],
  },
}

export default function CupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
