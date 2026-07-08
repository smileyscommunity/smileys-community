import posthog from 'posthog-js'

// Ingest through /ingest/* (rewritten to eu.i.posthog.com in next.config.js)
// so ad blockers don't drop events; ui_host keeps "View in PostHog" links
// pointing at the dashboard, not the proxy.
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/app/ingest',
  ui_host: 'https://eu.posthog.com',
  defaults: '2026-01-30',
  // PostHog Error Tracking (exception autocapture). Unhandled errors and
  // promise rejections become $exception events auto-linked to the session
  // replay. React error-boundary crashes are captured explicitly in
  // app/error.tsx + app/global-error.tsx (a boundary catches the error before
  // it reaches this global handler).
  capture_exceptions: true,
})
