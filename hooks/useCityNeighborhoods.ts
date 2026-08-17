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
export function useCityNeighborhoods(city?: string): string[] {
  const [neighborhoods, setNeighborhoods] = useState<string[]>([])

  useEffect(() => {
    // The cancelled flag drops out-of-order responses — a slow earlier fetch
    // must not overwrite a faster later one when `city` changes.
    let cancelled = false
    const url = city
      ? `/app/api/neighborhoods?city=${encodeURIComponent(city)}`
      : '/app/api/neighborhoods'
    fetch(url, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!cancelled) setNeighborhoods((d.neighborhoods ?? []).map((n: { name: string }) => n.name)) })
      .catch(() => { if (!cancelled) setNeighborhoods([]) })
    return () => { cancelled = true }
  }, [city])

  return neighborhoods
}
