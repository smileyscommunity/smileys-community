import * as Sentry from '@sentry/nextjs'

// Mirror of the URL/header scrub in instrumentation-client.ts. Server-side
// Sentry events can include the request URL, request headers, and stack
// traces of API route handlers — all places where tokens/cookies can leak.
function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const u = new URL(url, 'http://x')
    for (const k of ['token', 'secret', 'api_key', 'apiKey', 'access_token', 'refresh_token', 'code']) {
      if (u.searchParams.has(k)) u.searchParams.set(k, '[REDACTED]')
    }
    const out = u.origin === 'http://x' ? `${u.pathname}${u.search}` : u.toString()
    return out
  } catch {
    return url
  }
}

function commonOptions(dsn: string) {
  return {
    dsn,
    tracesSampleRate: 0.1,
    // Pin to false explicitly so a future SDK upgrade can't quietly start
    // shipping Cookie / Authorization headers and IP addresses.
    sendDefaultPii: false,
    beforeBreadcrumb(breadcrumb: Sentry.Breadcrumb) {
      if (breadcrumb.data && typeof breadcrumb.data.url === 'string') {
        breadcrumb.data.url = scrubUrl(breadcrumb.data.url) ?? breadcrumb.data.url
      }
      return breadcrumb
    },
    beforeSend(event: Sentry.ErrorEvent) {
      if (event.request?.url) event.request.url = scrubUrl(event.request.url) ?? event.request.url
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string>
        for (const k of Object.keys(h)) {
          if (/^(cookie|authorization|x-csrf|x-api-key)$/i.test(k)) h[k] = '[REDACTED]'
        }
      }
      return event
    },
  }
}

export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init(commonOptions(dsn))
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(commonOptions(dsn))
  }
}

export const onRequestError = Sentry.captureRequestError
