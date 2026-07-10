import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getIp } from '@/lib/rateLimit'

// CSP violation receiver. Browsers POST here whenever a script/style/etc.
// is blocked by the Content-Security-Policy header set by middleware.ts.
// Useful for catching regressions like the round-4 static-rendering issue
// (where Next.js stopped putting nonces on its script tags) BEFORE users
// report that the app is broken — every page load would have emitted a
// burst of violation reports.
//
// Endpoint is intentionally unauthenticated (browsers can't auth here)
// but rate-limited per IP. Browser extensions are a major noise source
// (extensions inject scripts that violate every site's CSP); the
// structured log line is grep-able so operators can filter that noise out
// without dropping legit signals.
//
// Two payload formats:
//   - Legacy `application/csp-report` — single object under `csp-report`
//   - Reporting API `application/reports+json` — array of report objects

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    return await handle(req)
  } catch (e) {
    // Browsers don't expect a meaningful response from report endpoints;
    // any non-2xx might make some implementations stop sending. Swallow.
    console.error('[csp-report] handler error', e instanceof Error ? e.message : String(e))
    return new NextResponse(null, { status: 204 })
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // Aggressive per-IP cap. A single page load with a serious CSP regression
  // can fan out dozens of reports (every blocked script tag = one report).
  // Fail open if the rate-limit DB is unreachable — losing visibility on
  // some reports is better than 500'ing on browser-issued POSTs.
  try {
    if (!await rateLimit(`csp-report:${getIp(req)}`, 60, 60_000)) {
      return new NextResponse(null, { status: 204 })
    }
  } catch { /* let the request through if rate-limit DB is unreachable */ }

  let body: unknown
  try { body = await req.json() }
  catch { return new NextResponse(null, { status: 204 }) }

  // Normalize both formats into a uniform shape.
  type Violation = {
    documentURI?:        string
    blockedURI?:         string
    violatedDirective?:  string
    effectiveDirective?: string
    scriptSample?:       string
    sourceFile?:         string
    lineNumber?:         number
    statusCode?:         number
    referrer?:           string
  }

  const violations: Violation[] = []
  if (Array.isArray(body)) {
    // Reporting API: [{ type: 'csp-violation', body: {...} }, ...]
    for (const entry of body) {
      const b = (entry as { body?: Violation })?.body
      if (b && typeof b === 'object') violations.push(b)
    }
  } else if (body && typeof body === 'object') {
    // Legacy: { 'csp-report': {...} }
    const report = (body as { 'csp-report'?: Violation })['csp-report']
    if (report) violations.push(report)
  }

  for (const v of violations) {
    // Filter known-noise sources. Browser extensions inject content from
    // chrome-extension:// / moz-extension:// / safari-web-extension:// URIs
    // that we have zero control over. Logging them obscures real signals.
    const blocked = v.blockedURI ?? ''
    if (
      blocked.startsWith('chrome-extension://') ||
      blocked.startsWith('moz-extension://') ||
      blocked.startsWith('safari-web-extension://') ||
      blocked === 'about'
    ) continue

    // Drop content-free reports: an empty blockedURI with no directive and no
    // source location carries zero actionable signal — it's overwhelmingly
    // extension-injected inline content the browser redacts to "". These were
    // flooding the logs (~1.9k). A genuine inline/nonce regression still logs,
    // because it populates violatedDirective + documentURI/sourceFile.
    const directive = v.violatedDirective ?? v.effectiveDirective ?? ''
    if (!blocked && !directive && !v.sourceFile && !v.documentURI) continue

    // Structured single-line log so it's grep-able in PM2 logs:
    //   grep '\[csp-violation\]' /root/.pm2/logs/smileys-out.log
    console.warn('[csp-violation]', JSON.stringify({
      documentURI:        v.documentURI,
      blockedURI:         blocked,
      violatedDirective:  v.violatedDirective ?? v.effectiveDirective,
      sourceFile:         v.sourceFile,
      lineNumber:         v.lineNumber,
      scriptSample:       v.scriptSample?.slice(0, 200),
      ip:                 getIp(req),
      ua:                 req.headers.get('user-agent')?.slice(0, 200),
    }))
  }

  return new NextResponse(null, { status: 204 })
}
