'use client'

import { useState, useEffect } from 'react'

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
}

export function useCurrentCity(): CurrentCity | null {
  const [city, setCity] = useState<CurrentCity | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/app/api/city/current', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.name) setCity({ name: d.name, slug: d.slug, isDefault: !!d.isDefault }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return city
}
