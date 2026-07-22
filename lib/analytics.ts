import posthog from 'posthog-js'

// Thin, crash-proof wrapper around posthog.capture for client components.
// posthog-js is initialised in instrumentation-client.ts; this just adds a
// window guard and a try/catch so a missing/blocked analytics client can
// never break a user interaction (an ad-blocked visitor still gets the UI).
export function track(event: string, props?: Record<string, unknown>) {
  try {
    if (typeof window !== 'undefined') posthog.capture(event, props)
  } catch {
    /* analytics is best-effort — never throw into the UI */
  }
}
