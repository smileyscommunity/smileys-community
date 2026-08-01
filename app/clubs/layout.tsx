import { APP_URL } from '@/lib/env'

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

export default function ClubsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
