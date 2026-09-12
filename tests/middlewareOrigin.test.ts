import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

// Origin-based CSRF gate in middleware.ts. The app runs under basePath /app,
// and in production Next hands middleware a nextUrl whose pathname has the
// basePath stripped — so requests are built with nextConfig.basePath to match.

const HOST = 'smileys.example'

function mk(path: string, method: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://${HOST}/app${path}`, {
    method,
    headers: { host: HOST, ...headers },
    nextConfig: { basePath: '/app' },
  })
}

// A pass-through returns NextResponse.next(), which Next marks with this header.
const passed = (res: Response) => res.headers.get('x-middleware-next') === '1'

describe('middleware origin check', () => {
  it('sees the basePath-stripped pathname, as in production', () => {
    expect(mk('/api/x', 'POST').nextUrl.pathname).toBe('/api/x')
  })

  it('403s a POST to /api/x with no Origin and no Referer', async () => {
    const res = middleware(mk('/api/x', 'POST'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Origin required' })
  })

  it.each(['PUT', 'PATCH', 'DELETE'])('403s a %s with no Origin too', (method) => {
    expect(middleware(mk('/api/x', method)).status).toBe(403)
  })

  it('403s a mismatched Origin host', async () => {
    const res = middleware(mk('/api/x', 'POST', { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Origin mismatch' })
  })

  it('403s a lookalike host (suffix/port differences are not the same host)', () => {
    expect(middleware(mk('/api/x', 'POST', { origin: `https://${HOST}.evil.example` })).status).toBe(403)
    expect(middleware(mk('/api/x', 'POST', { origin: `https://${HOST}:8443` })).status).toBe(403)
  })

  it('403s an unparseable Origin', async () => {
    const res = middleware(mk('/api/x', 'POST', { origin: 'not a url' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Invalid Origin' })
  })

  it('passes a same-host Origin', () => {
    const res = middleware(mk('/api/x', 'POST', { origin: `https://${HOST}` }))
    expect(res.status).toBe(200)
    expect(passed(res)).toBe(true)
  })

  it('falls back to a same-host Referer when Origin is absent', () => {
    const res = middleware(mk('/api/x', 'POST', { referer: `https://${HOST}/app/settings` }))
    expect(passed(res)).toBe(true)
  })

  it('a mismatched Referer is still refused', () => {
    expect(middleware(mk('/api/x', 'POST', { referer: 'https://evil.example/page' })).status).toBe(403)
  })

  it('skips GET (and HEAD) entirely, even with no Origin', () => {
    expect(passed(middleware(mk('/api/x', 'GET')))).toBe(true)
    expect(passed(middleware(mk('/api/x', 'HEAD')))).toBe(true)
  })

  it('skips non-API paths', () => {
    expect(passed(middleware(mk('/events', 'POST')))).toBe(true)
  })

  it.each(['/api/csp-report', '/api/webhooks/resend', '/api/unsubscribe'])(
    'exempt path %s passes a POST with no Origin',
    (path) => {
      expect(passed(middleware(mk(path, 'POST')))).toBe(true)
    },
  )

  it('exemptions are exact matches, not prefixes', () => {
    expect(middleware(mk('/api/unsubscribe/extra', 'POST')).status).toBe(403)
    expect(middleware(mk('/api/webhooks/other', 'POST')).status).toBe(403)
  })
})
