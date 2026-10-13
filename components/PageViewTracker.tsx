'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics'

// Fires one named page-view event on mount. Props must be non-identifying;
// consent is enforced by posthog's opt-out (instrumentation-client.ts).
export default function PageViewTracker({ event, props }: { event: string; props?: Record<string, string | number | boolean | null> }) {
  useEffect(() => { track(event, props) }, [event, props])
  return null
}
