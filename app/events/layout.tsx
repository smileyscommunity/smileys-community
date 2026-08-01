import { APP_URL } from '@/lib/env'

// See app/about/page.tsx for why this is needed — a page-level `openGraph`
// block loses the root layout's default og:image, so /events shared with
// no preview at all on WhatsApp/iMessage/Twitter until this was added.
// (events/[id] pages already set their own og:image from the event's cover
// photo — this only covers the /events list page itself.)
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Events in Istanbul',
  eyebrow: 'Smileys Community',
  cta:     'Browse events',
}).toString()}`

export const metadata = {
  // Safe now that events/[id] sets its own canonical (overrides this one).
  alternates: { canonical: `${APP_URL}/events` },
  title: 'Events in Istanbul — Smileys Community',
  description: 'Discover curated social events in Istanbul — dinners, photowalks, sailing trips, language meetups and more. Join Smileys and find your next experience.',
  openGraph: {
    title: 'Istanbul Events — Smileys Community',
    description: 'Curated social events across Istanbul every week. Find dinners, outdoor adventures, cultural meetups and more.',
    url: `${APP_URL}/events`,
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Events in Istanbul — Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Istanbul Events — Smileys Community',
    description: 'Curated social events across Istanbul every week. Find dinners, outdoor adventures, cultural meetups and more.',
    images: [ogImage],
  },
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
