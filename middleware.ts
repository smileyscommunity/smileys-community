import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Middleware does two things on every request:
//
// 1. Origin-based CSRF defense for state-changing API calls.
//    Defense in depth on top of `sameSite: 'lax'` cookies: every mutating
//    API call must carry an Origin (or Referer) whose host matches the
//    request's host. Same-origin browser fetches always satisfy this;
//    cross-site form submissions and headless attackers without a forged
//    Origin won't.
//
// 2. Per-request CSP nonce.
//    Generates a fresh nonce per request, embeds it in `script-src` with
//    `'strict-dynamic'`, and exposes it as the `x-nonce` request header so
//    layouts can read it via `headers()` and pass it to <Script> or
//    <script> tags. `'unsafe-inline'` and `'unsafe-eval'` are kept for
//    legacy-browser fallback and for libraries that still need eval
//    (PostHog session replay, Sentry breadcrumbs); modern browsers see
//    `'strict-dynamic'` + the nonce and ignore the unsafe-inline fallback,
//    so stored/reflected XSS without a valid nonce is blocked.

const PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function checkOrigin(req: NextRequest): NextResponse | null {
  if (!PROTECTED_METHODS.has(req.method)) return null
  if (!req.nextUrl.pathname.startsWith('/api/')) return null
  // CSP violation reports are POSTed by the browser to this public endpoint;
  // some browsers omit the Origin header on report-uri requests, and there's
  // no session to forge across origins anyway. Skip the CSRF gate here.
  if (req.nextUrl.pathname === '/api/csp-report') return null
  // Resend/svix deliver webhooks server-to-server with no Origin header, so the
  // CSRF gate would 403 them. They carry no session cookie and are authenticated
  // by svix HMAC signature in the handler instead — skip the Origin check here.
  if (req.nextUrl.pathname === '/api/webhooks/resend') return null

  const host = req.headers.get('host')
  if (!host) {
    return NextResponse.json({ error: 'Missing Host header' }, { status: 400 })
  }

  // Prefer Origin (set on cross-site requests); fall back to Referer because
  // some same-origin requests omit Origin.
  const originHeader = req.headers.get('origin') ?? req.headers.get('referer')
  if (!originHeader) {
    return NextResponse.json({ error: 'Origin required' }, { status: 403 })
  }

  let originHost: string
  try {
    originHost = new URL(originHeader).host
  } catch {
    return NextResponse.json({ error: 'Invalid Origin' }, { status: 403 })
  }

  if (originHost !== host) {
    return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 })
  }

  return null
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // Modern browsers: `'strict-dynamic'` + nonce ignore everything else in
    // script-src and only run scripts with the matching nonce (or scripts
    // loaded by those). Legacy browsers fall back to `'unsafe-inline'` +
    // host allowlist. `'unsafe-eval'` kept because PostHog session replay
    // and some Sentry breadcrumb code use Function()/eval at runtime.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com`,
    // Inline styles are pervasive in this app (Tailwind utilities + styled-jsx
    // + emotion). Nonce-based style enforcement is impractical without a
    // larger refactor. Keep `'unsafe-inline'` — XSS impact via inline CSS is
    // much lower than via JS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://challenges.cloudflare.com https://*.tile.openstreetmap.org https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://api.open-meteo.com",
    "font-src 'self' data:",
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Tell the browser where to POST violation reports. Catches silent CSP
    // regressions — if a future deploy stops applying nonces correctly, every
    // page load fires a burst of reports we can grep out of PM2 logs:
    //   grep '\[csp-violation\]' /root/.pm2/logs/smileys-out.log
    // Browsers strip query params and credentials from reporting POSTs, so
    // the receiver at /api/csp-report stays public + rate-limited.
    "report-uri /app/api/csp-report",
  ].join('; ')
}

export function middleware(req: NextRequest) {
  const csrfFail = checkOrigin(req)
  if (csrfFail) return csrfFail

  // crypto.randomUUID is available in the Edge runtime. Strip hyphens so the
  // CSP header doesn't get confused by them — base16 is sufficient entropy.
  const nonce     = crypto.randomUUID().replace(/-/g, '')
  // Correlation ID: short enough to grep, unique enough to trace a single
  // request across API routes, server components, and PM2 logs. Read it
  // in any server route via `headers().get('x-request-id')` and include it
  // in console.error calls so a log line maps back to the browser request.
  const requestId = crypto.randomUUID()
  const csp = buildCsp(nonce)

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('content-security-policy', csp)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('content-security-policy', csp)
  // Expose the ID on the response so it appears in browser DevTools network
  // panel and can be quoted in bug reports.
  res.headers.set('x-request-id', requestId)

  return res
}

export const config = {
  // Run on every request except static assets the framework serves directly.
  // Includes /api/* (for the origin/CSRF check above) and pages (for CSP).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons/|fonts/).*)',
  ],
}
