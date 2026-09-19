'use client'

import { useEffect, useState } from 'react'

export interface HomeCity {
  id:      string
  slug:    string
  name:    string
  // ISO 3166-1 alpha-2, for phone placeholders. Null when unknown.
  country: string | null
}

// The member's HOME city — not the one they're browsing.
//
// useCurrentCity answers "which city are these feeds showing", which follows
// the view-city cookie. The profile editor needs the other answer: the server
// validates a saved neighbourhood against the member's own city, so a picker
// built from the browsed city offered names that were then rejected (or, when
// the stored name wasn't in the list, showed "Select…" over a real value).
//
// `loading` is true until the lookup settles; `home` stays null if it fails,
// and callers show what they have rather than guessing a city.
export function useHomeCity(): { home: HomeCity | null; loading: boolean } {
  const [home,    setHome]    = useState<HomeCity | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/app/api/me/cities', { credentials: 'include', cache: 'no-store' })
        const d = r.ok ? await r.json() : null
        const h = Array.isArray(d?.cities) ? d.cities.find((c: { home?: boolean }) => c.home) : null
        if (!h?.id || !h?.slug) return
        // ?cityId= describes exactly that city (no cookie fallback), which is
        // where the country for the phone hint comes from.
        const cr = await fetch(`/app/api/city/current?cityId=${encodeURIComponent(h.id)}`, { credentials: 'include' })
        const cd = cr.ok ? await cr.json().catch(() => null) : null
        if (cancelled) return
        setHome({
          id: h.id, slug: h.slug, name: h.name ?? '',
          country: typeof cd?.country === 'string' && cd.country ? cd.country : null,
        })
      } catch {
        // Leave home null; the caller renders without a city.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return { home, loading }
}
