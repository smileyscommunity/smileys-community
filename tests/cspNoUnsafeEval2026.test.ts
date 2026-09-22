import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-09-23. script-src carried both `'unsafe-inline'` and `'unsafe-eval'`.
// The first is inert — `'strict-dynamic'` makes modern browsers ignore it,
// and it only exists so ancient ones still run our scripts. The second is
// NOT inert: browsers honour it, and it re-opens the exact class of attack
// the nonce is there to close. It had been kept for a reason that had since
// stopped being true ("PostHog session replay uses Function()/eval").
//
// Evidence gathered before removing it: 0 eval/Function across posthog-js's
// 124 dist files, 0 across Turnstile's loader, and the only hits in our own
// production bundle are `Function("return this")` globalThis fallbacks that
// sit behind a `typeof globalThis == 'object'` check.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('content security policy', () => {
  const mw = src('middleware.ts')
  // The directive itself, not the prose about it: an earlier version of this
  // test matched a comment line mentioning `script-src` and "passed" without
  // ever reading the policy.
  const scriptSrc = mw.split('\n').find(l => /^\s*`script-src /.test(l)) ?? ''

  it('found the actual directive to assert against', () => {
    expect(scriptSrc).not.toBe('')
    expect(scriptSrc).toContain("'self'")
  })

  it('does not allow eval', () => {
    expect(scriptSrc).not.toContain('unsafe-eval')
  })

  it('still nonces every script and keeps strict-dynamic', () => {
    // Removing unsafe-eval is only safe because these two still carry the
    // policy. A change that dropped either would make the line above pass
    // while making the page less safe, not more.
    expect(scriptSrc).toContain("'nonce-${nonce}'")
    expect(scriptSrc).toContain("'strict-dynamic'")
  })

  it('keeps the violation receiver wired, since it is the safety net', () => {
    expect(mw).toContain('report-uri')
  })
})

describe('response headers', () => {
  it('does not advertise the framework', () => {
    expect(src('next.config.js')).toContain('poweredByHeader: false')
  })
})
