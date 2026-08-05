import { APP_URL } from '@/lib/env'

// See app/about/page.tsx for why this is needed — a page-level `openGraph`
// block loses the root layout's default og:image, so /events shared with
// no preview at all on WhatsApp/iMessage/Twitter until this was added.
// (events/[id] pages already set their own og:image from the event's cover
// photo — this only covers the /events list page itself.)
// Branded share card (1200x1200, ~354KB). Square by design: it doubles
// as the Instagram asset, and twitter card 'summary' renders it uncropped
// where 'summary_large_image' would letterbox it.
const ogImage = `${APP_URL}/images/events-og.jpg`

export const metadata = {
  // Safe now that events/[id] sets its own canonical (overrides this one).
  alternates: { canonical: `${APP_URL}/events` },
  title: 'Events in Istanbul — Smileys Community',
  description: 'Discover curated social events in Istanbul — dinners, photowalks, sailing trips, language meetups and more. Join Smileys and find your next experience.',
  openGraph: {
    title: 'Smileys Events — Find something worth showing up for.',
    description: 'Meet people, try something new and experience Istanbul together.',
    url: `${APP_URL}/events`,
    images: [{ url: ogImage, width: 1200, height: 1200, alt: 'Smileys Events — every week, new experiences, lasting memories' }],
  },
  twitter: {
    card: 'summary',
    title: 'Smileys Events — Find something worth showing up for.',
    description: 'Meet people, try something new and experience Istanbul together.',
    images: [ogImage],
  },
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
