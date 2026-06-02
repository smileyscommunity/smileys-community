import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'

// Scrub auth-bearing tokens out of URLs that land in Sentry events /
// breadcrumbs. Catches password-reset / email-verification / activation
// links (which all carry `?token=`), magic-link callbacks, and any custom
// `?secret=` / `?api_key=` patterns. Leaves the path + other query params
// intact so the breadcrumb is still useful for debugging.
function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const u = new URL(url, 'http://x') // base for relative URLs
    for (const k of ['token', 'secret', 'api_key', 'apiKey', 'access_token', 'refresh_token', 'code']) {
      if (u.searchParams.has(k)) u.searchParams.set(k, '[REDACTED]')
    }
    // Reconstruct keeping pathname + scrubbed search. Origin only kept if it
    // wasn't the synthetic base we used for relative URLs.
    const out = u.origin === 'http://x'
      ? `${u.pathname}${u.search}`
      : u.toString()
    return out
  } catch {
    return url
  }
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.01,
  integrations: [Sentry.replayIntegration()],

  // Sentry SDK 8+ defaults `sendDefaultPii` to false, which strips Cookie /
  // Authorization headers and the user's IP from events. Pin it explicitly
  // so a future SDK upgrade that flips the default doesn't quietly start
  // shipping PII.
  sendDefaultPii: false,

  // Scrub auth tokens out of breadcrumb URLs (XHR/fetch instrumentation
  // captures the URL on every request). Without this, the password-reset
  // flow would post a breadcrumb like `GET /reset-password?token=abc123...`
  // every time the form rendered.
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data && typeof breadcrumb.data.url === 'string') {
      breadcrumb.data.url = scrubUrl(breadcrumb.data.url) ?? breadcrumb.data.url
    }
    return breadcrumb
  },

  // Same scrub for the request URL on the actual error event, plus drop
  // any Cookie / Authorization header that might have slipped through
  // despite sendDefaultPii=false (defense in depth for SDK regressions).
  beforeSend(event) {
    if (event.request?.url) event.request.url = scrubUrl(event.request.url) ?? event.request.url
    if (event.request?.headers) {
      const h = event.request.headers as Record<string, string>
      for (const k of Object.keys(h)) {
        if (/^(cookie|authorization|x-csrf|x-api-key)$/i.test(k)) h[k] = '[REDACTED]'
      }
    }
    return event
  },
})

// Ingest through /ingest/* (rewritten to eu.i.posthog.com in next.config.js)
// so ad blockers don't drop events; ui_host keeps "View in PostHog" links pointing
// at the dashboard, not the proxy.
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: '/app/ingest',
  ui_host: 'https://eu.posthog.com',
  defaults: '2026-01-30',
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
