import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.01,
  integrations: [Sentry.replayIntegration()],
})

// Ingest through /ingest/* (rewritten to eu.i.posthog.com in next.config.js)
// so ad blockers don't drop events; ui_host keeps "View in PostHog" links pointing
// at the dashboard, not the proxy.
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/ingest',
  ui_host: 'https://eu.posthog.com',
  defaults: '2026-01-30',
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
