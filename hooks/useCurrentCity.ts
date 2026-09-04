'use client'

import { useState, useEffect } from 'react'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { DEFAULT_CURRENCY } from '@/lib/data'

// The city the viewer's feeds resolve to (view-city cookie → their home city →
// default), for client components that need to NAME it.
//
// /api/city/current already serves this and /clubs and /directory already read
// it inline; this is the same call behind one name, because the board was the
// third place to need it. It exists because those page headings used to be
// hardcoded — "💬 Istanbul Board", "What's happening, Istanbul?" — so a member
// in Bodrum was told they were looking at Istanbul's board while the feed
// underneath correctly showed Bodrum's listings.
//
// Returns null until it resolves. Callers render nothing city-specific in that
// window rather than flashing the wrong city, the same trade JoinCityButton
// makes while auth loads.
export interface CurrentCity {
  name:     string
  slug:     string
  isDefault: boolean
  // The CITY's timezone, not the viewer's. Client components render "today",
  // "tomorrow" and clock times from this; they used to hardcode the founding
  // city's zone, which is a wrong answer about which DAY it is the moment a
  // city sits outside it. Falls back to DEFAULT_TZ until the fetch resolves.
  timezone: string
  // Money and phone placeholders follow the city too: a lira sign or a +90
  // hint is one country's answer.
  currency: string
  country:  string | null
  // True when the view-city cookie has moved this viewer off their own city,
  // with the city "back" returns to. Feeds render an escape hatch from these —
  // the cookie lasts a year, so viewing another city needs a visible way home.
  viewing:  boolean
  homeName: string | null
  // Where a POST from this member would land, which is not always the city
  // above: a write follows membership, not the view-city cookie, so browsing
  // another city's board files your listing back home unless you've joined
  // that city. `differs` is that case, and the only one worth explaining in
  // the UI. Absent for guests, who have nothing to post with.
  posting?: { name: string; slug: string; differs: boolean }
}

// One fetch per page load, shared by every caller.
//
// Each consumer used to issue its own request, and a page can easily hold
// several — a header, a feed, and now anything rendering a time. Once event
// cards need the city's timezone that becomes one request per card, which is
// silly for a value that cannot change without a navigation. The cookie only
// changes via /api/city/enter or /api/me/view-city, both of which reload.
let cached: CurrentCity | null = null
let inFlight: Promise<CurrentCity | null> | null = null

function loadCity(): Promise<CurrentCity | null> {
  if (cached) return Promise.resolve(cached)
  if (!inFlight) {
    inFlight = fetch('/app/api/city/current', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d?.name) return null
        cached = {
          name: d.name, slug: d.slug, isDefault: !!d.isDefault,
          timezone: typeof d.timezone === 'string' && d.timezone ? d.timezone : DEFAULT_TZ,
          currency: typeof d.currency === 'string' && d.currency ? d.currency : DEFAULT_CURRENCY,
          country:  typeof d.country  === 'string' && d.country  ? d.country  : null,
          viewing:  !!d.viewing,
          homeName: typeof d.homeName === 'string' ? d.homeName : null,
          ...(d.posting?.name ? { posting: { name: d.posting.name, slug: d.posting.slug, differs: !!d.posting.differs } } : {}),
        }
        return cached
      })
      // Don't cache a failure: the next component to mount should retry
      // rather than inherit one bad network moment for the whole page.
      .catch(() => { inFlight = null; return null })
  }
  return inFlight
}

export function useCurrentCity(): CurrentCity | null {
  const [city, setCity] = useState<CurrentCity | null>(cached)

  useEffect(() => {
    if (cached) { setCity(cached); return }
    let cancelled = false
    loadCity()
      .then(c => { if (!cancelled && c) setCity(c) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return city
}
