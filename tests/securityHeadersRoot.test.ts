import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Regression: with basePath '/app', the security-header source '/(.*)' and the
// middleware matcher both compiled to '/app/…', so the bare homepage URL /app
// shipped with no CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy or
// Permissions-Policy while every other page had them. These checks run the
// patterns through Next's own compilers so a future edit can't reopen the gap.

const require = createRequire(import.meta.url)
const nextConfig = require('../next.config.js')
const loadCustomRoutes = require('next/dist/lib/load-custom-routes').default
const { getPathMatch } = require('next/dist/shared/lib/router/utils/path-match')
const { getMiddlewareMatchers } = require('next/dist/build/analysis/get-page-static-info')

const PATHS = ['/app', '/app/', '/app/events', '/app/events/', '/app/istanbul', '/app/api/health']

describe('security headers cover the homepage', () => {
  it('next.config headers() security block matches /app and every other path', async () => {
    const routes = await loadCustomRoutes(nextConfig)
    const sec = routes.headers.filter((r: { headers: { key: string }[] }) =>
      r.headers.some(h => h.key === 'X-Frame-Options'))
    expect(sec.length).toBe(1)
    const match = getPathMatch(sec[0].source, { removeUnnamedParams: true, strict: true })
    for (const p of PATHS) expect(match(p), p).not.toBe(false)
    const keys = sec[0].headers.map((h: { key: string }) => h.key)
    for (const k of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy',
      'Permissions-Policy', 'Strict-Transport-Security']) expect(keys).toContain(k)
  })

  it('middleware (CSP) matcher runs on /app and every other page path', () => {
    const src = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8')
    const literal = src.match(/matcher:\s*(\[[\s\S]*?\])/)?.[1]
    expect(literal).toBeTruthy()
    const matcher = new Function(`return ${literal}`)() as string[]
    const compiled = getMiddlewareMatchers(matcher, nextConfig) as { regexp: string }[]
    for (const p of PATHS) {
      expect(compiled.some(m => new RegExp(m.regexp).test(p)), p).toBe(true)
    }
    // Static assets stay excluded.
    expect(compiled.some(m => new RegExp(m.regexp).test('/app/_next/static/chunks/x.js'))).toBe(false)
  })
})
