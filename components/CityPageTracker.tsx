'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics'

// Fires one PostHog view event per city-page mount (works for guests too —
// posthog-js carries the anonymous id). Status rides along so pre-launch
// interest pages and live shopfronts separate cleanly in funnels.
export default function CityPageTracker({ slug, status }: { slug: string; status: string }) {
  useEffect(() => {
    track('city_page_view', { city: slug, status })
  }, [slug, status])
  return null
}
