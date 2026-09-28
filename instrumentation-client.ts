import posthog from 'posthog-js'
import { hasAnalyticsConsent } from '@/lib/consent'

// Ingest through /ingest/* (rewritten to eu.i.posthog.com in next.config.js)
// so ad blockers don't drop events; ui_host keeps "View in PostHog" links
// pointing at the dashboard, not the proxy.
//
// Consent first (lib/consent, 2026-09-29): capturing starts OFF and nothing
// is persisted — no ph_* cookie, no localStorage — until the visitor presses
// "Accept all" on the cookie banner, which opts in (components/CookieBanner).
// It used to start for everyone, session replay included, whatever the
// banner said.
const consented = hasAnalyticsConsent()
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/app/ingest',
  ui_host: 'https://eu.posthog.com',
  defaults: '2026-01-30',
  opt_out_capturing_by_default: !consented,
  persistence: consented ? 'localStorage+cookie' : 'memory',
  disable_session_recording: !consented,
  // Before consent nothing is fetched either: no recorder/extension scripts,
  // and feature flags and surveys (unused here) are off for everyone — the
  // flags call told PostHog every visitor's address on page load.
  disable_external_dependency_loading: !consented,
  advanced_disable_flags: true,
  disable_surveys: true,
  // PostHog Error Tracking (exception autocapture). Unhandled errors and
  // promise rejections become $exception events auto-linked to the session
  // replay. React error-boundary crashes are captured explicitly in
  // app/error.tsx + app/global-error.tsx (a boundary catches the error before
  // it reaches this global handler). Like everything else here, only after
  // consent.
  capture_exceptions: true,
})
