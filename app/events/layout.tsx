import type { Metadata } from 'next'
import { APP_URL } from '@/lib/env'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig, DEFAULT_CITY_SLUG } from '@/lib/city'

// See app/about/page.tsx for why this is needed — a page-level `openGraph`
// block loses the root layout's default og:image, so /events shared with
// no preview at all on WhatsApp/iMessage/Twitter until this was added.
// (events/[id] pages already set their own og:image from the event's cover
// photo — this only covers the /events list page itself.)
// Branded share card (1200x1200, ~354KB). Square by design: it doubles
// as the Instagram asset, and twitter card 'summary' renders it uncropped
// where 'summary_large_image' would letterbox it.
const ogImage = `${APP_URL}/images/events-og.jpg`

// Names the city whose events you're actually being shown (same pattern as
// app/directory/layout.tsx): the events list scopes per city, so an Izmir
// member browsing here shouldn't do it under a title reading "in Istanbul".
//
// The DEFAULT city keeps its exact indexed strings — this page is indexed
// under "events in Istanbul", and rewording a title Google already has costs
// something for nothing. Crawlers carry no cookie, so they resolve to the
// default city and see precisely what they see today.
export async function generateMetadata(): Promise<Metadata> {
  const cfg       = await getCityConfig(await resolveCityId(await getSession()))
  const name      = cfg.name
  const isDefault = cfg.slug === DEFAULT_CITY_SLUG
  const title     = `Events in ${name} — Smileys Community`
  const desc      = isDefault
    ? 'Discover curated social events in Istanbul — dinners, photowalks, sailing trips, language meetups and more. Join Smileys and find your next experience.'
    : `Discover curated social events in ${name} — dinners, photowalks, language meetups and more. Join Smileys and find your next experience.`
  const ogDesc    = isDefault
    ? 'Meet people, try something new and experience Istanbul together.'
    : `Meet people, try something new and experience ${name} together.`

  return {
    // Safe now that events/[id] sets its own canonical (overrides this one).
    // A viewer pinned to another city sees that city's list here, whose
    // canonical home is its crawlable hub (/[city]/events); the default
    // city's remains this URL, which Google already has.
    alternates: { canonical: isDefault ? `${APP_URL}/events` : `${APP_URL}/${cfg.slug}/events` },
    title,
    description: desc,
    openGraph: {
      title: 'Smileys Events — Find something worth showing up for.',
      description: ogDesc,
      url: `${APP_URL}/events`,
      images: [{ url: ogImage, width: 1200, height: 1200, alt: 'Smileys Events — every week, new experiences, lasting memories' }],
    },
    twitter: {
      card: 'summary',
      title: 'Smileys Events — Find something worth showing up for.',
      description: ogDesc,
      images: [ogImage],
    },
  }
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
