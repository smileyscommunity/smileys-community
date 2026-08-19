import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// A Turnstile token dies after ~5 minutes, which any real login page reaches:
// open the tab, get distracted, come back. The widget handled that by nulling
// its widget id — and reset() needs that id, so the reset path became a
// permanent no-op. The token was gone, no new one could be issued, and the
// only way out was a full page reload. Production logs showed the result as a
// run of 'timeout-or-duplicate', 'invalid-input-response' and
// 'missing-input-response' rejections against /api/auth/login, surfacing to
// the member as a "human verification failed" that would not clear.
//
// A source guard rather than a render test: the component is driven entirely
// by Cloudflare's callbacks against window.turnstile, and this suite runs in
// vitest's node environment with no DOM. Same approach as cityHardcoding and
// navLinks — cheap, and it fails loudly if someone reinstates the null.

const SRC = readFileSync(join(process.cwd(), 'components/Turnstile.tsx'), 'utf8')

// The `expired-callback: () => { ... }` body.
const expiredBody = SRC.split("'expired-callback':")[1]?.split("'error-callback':")[0] ?? ''
// The effect that reacts to a parent's resetSignal bump.
const resetEffect = SRC.split('if (!resetSignal) return')[1]?.split('}, [resetSignal])')[0] ?? ''

describe('Turnstile expiry recovery', () => {
  it('has an expired-callback at all', () => {
    expect(expiredBody).not.toBe('')
  })

  it('does not throw away the widget handle on expiry — reset() needs it', () => {
    expect(expiredBody).not.toMatch(/widgetId\.current\s*=\s*null/)
  })

  it('resets the widget on expiry, so a fresh token is issued without a reload', () => {
    expect(expiredBody).toMatch(/turnstile\.reset\(/)
  })

  it('still tells the parent the token is gone, so the submit button disables', () => {
    expect(expiredBody).toMatch(/onExpire\?\.\(\)/)
  })
})

describe('Turnstile reset signal', () => {
  it('exists and reacts to the parent bumping resetSignal', () => {
    expect(resetEffect).not.toBe('')
  })

  it('falls back to a re-mount when there is no live handle', () => {
    // Parents bump resetSignal after a REJECTED submit — precisely when the
    // widget may hold no live handle. A bare reset() would silently do
    // nothing and the form could never obtain another token.
    expect(resetEffect).toMatch(/setRetry\(/)
  })

  it('does not depend on a handle being present to recover', () => {
    const guardedOnly = /if\s*\(\s*widgetId\.current[^)]*\)\s*window\.turnstile\.reset\([^)]*\)\s*$/m
    expect(resetEffect.trim()).not.toMatch(guardedOnly)
  })
})
