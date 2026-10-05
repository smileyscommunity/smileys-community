'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics'

// A view of an event page itself. `event_viewed` only fires from a card click
// inside the app, so a visitor who lands from a WhatsApp share, a search result
// or a direct link was never counted — and those are the arrivals the funnel
// (event view → Join click → application) most needs to see. `source` is the
// referrer's host or the utm_source, never the full URL.
function sourceOf(): string {
  try {
    const utm = new URLSearchParams(window.location.search).get('utm_source')
    if (utm) return utm.slice(0, 40)
    if (!document.referrer) return 'direct'
    const host = new URL(document.referrer).hostname
    return host === window.location.hostname ? 'internal' : host.replace(/^www\./, '')
  } catch { return 'direct' }
}

export default function EventPageTracker({ eventId, citySlug, audience, membersOnly }: {
  eventId: string; citySlug: string | null; audience: 'guest' | 'member'; membersOnly: boolean
}) {
  useEffect(() => {
    track('event_page_view', { event_id: eventId, city: citySlug, audience, members_only: membersOnly, source: sourceOf() })
  }, [eventId, citySlug, audience, membersOnly])
  return null
}
