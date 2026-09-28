'use client'

import { useState, useEffect } from 'react'

// The neighborhood names of the city the viewer is in, for form selects and
// area filters. Replaces the `ISTANBUL_NEIGHBORHOODS` import those selects
// used to map over.
//
// Why it matters: every write path already validates the submitted name
// against the *member's own* city (`safeNeighborhoodFor` in
// lib/neighborhoodsDb.ts), and that helper returns null rather than an error
// on a mismatch. So a dropdown offering Istanbul's names to a member of any
// other city didn't fail loudly — it saved the row with the neighborhood
// silently dropped to empty.
//
// `city` (a slug) overrides the viewer's own city, for the pickers where the
// neighborhood belongs somewhere else — a visit's destination, say. Omit it
// and the API resolves the viewer's city itself (view-city cookie → their own
// city → the default), which is what a "post in my city" form wants.
//
// `null` means "the city isn't known yet": fetch nothing and return []. A
// composer waiting on its POSTING city (lib/postingNeighborhoods) passes null
// rather than undefined, which would fetch the browsed city's list and flash
// it before the posting city's arrived.
export function useCityNeighborhoods(city?: string | null, opts: { forApply?: boolean } = {}): string[] {
  return useCityNeighborhoodList(city, opts).list
}

/**
 * The same list plus whether it has arrived — an empty list that is still
 * loading and an empty list that is the answer ("this city has none on
 * file") mean different things to a form that requires a pick.
 */
export function useCityNeighborhoodList(city?: string | null, opts: { forApply?: boolean } = {}): { list: string[]; loaded: boolean } {
  const [neighborhoods, setNeighborhoods] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (city === null) { setNeighborhoods([]); setLoaded(false); return }
    setLoaded(false)
    // The cancelled flag drops out-of-order responses — a slow earlier fetch
    // must not overwrite a faster later one when `city` changes.
    let cancelled = false
    const url = city
      ? `/app/api/neighborhoods?city=${encodeURIComponent(city)}${opts.forApply ? '&for=apply' : ''}`
      : '/app/api/neighborhoods'
    // The bare URL answers from the view-city cookie, so it must never come
    // from the HTTP cache: it was served public, max-age=60 + 300s stale, and
    // a city switch kept showing the old city's names for minutes. ?city= is
    // keyed by its URL and may use the cache.
    fetch(url, { credentials: 'include', cache: city ? 'default' : 'no-store' })
      .then(r => r.json())
      .then(d => { if (!cancelled) { setNeighborhoods((d.neighborhoods ?? []).map((n: { name: string }) => n.name)); setLoaded(true) } })
      .catch(() => { if (!cancelled) { setNeighborhoods([]); setLoaded(false) } })
    return () => { cancelled = true }
  }, [city, opts.forApply])

  return { list: neighborhoods, loaded }
}
