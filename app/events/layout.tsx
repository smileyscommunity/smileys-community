import { APP_URL } from '@/lib/env'

export const metadata = {
  // Safe now that events/[id] sets its own canonical (overrides this one).
  alternates: { canonical: `${APP_URL}/events` },
  title: 'Events in Istanbul — Smileys Community',
  description: 'Discover curated social events in Istanbul — dinners, photowalks, sailing trips, language meetups and more. Join Smileys and find your next experience.',
  openGraph: {
    title: 'Istanbul Events — Smileys Community',
    description: 'Curated social events across Istanbul every week. Find dinners, outdoor adventures, cultural meetups and more.',
    url: 'https://smileyscommunity.com/events',
  },
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
