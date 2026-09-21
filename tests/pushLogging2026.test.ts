import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-09-22. A member asked why a published article never reached their
// phone. lib/push.ts said nothing at all — a rejected VAPID signature, an
// oversized payload, a throttled push service and a perfectly delivered
// notification were all the same silence — so the only way to answer was a
// query against the production database. Failures speak now; the happy path
// still doesn't, because a fan-out to a thousand members must not write a
// thousand lines.

const src = readFileSync(join(__dirname, '..', 'lib/push.ts'), 'utf8')

describe('push failures are visible', () => {
  it('a missing VAPID config says so — once per process, not once per send', () => {
    expect(src).toContain("console.error('[push] VAPID is not configured")
    expect(src).toContain('let vapidWarned = false')
    expect(src).toContain('if (!vapidWarned) {')
  })

  it('a send failure that is not an expiry is logged with its status', () => {
    expect(src).toContain("console.error('[push] send failed'")
    expect(src).toContain('status: err?.statusCode ?? null,')
    // …and the expiry path still cleans up rather than logging an error.
    expect(src).toContain('stale.push(sub.id)')
    expect(src).toContain("console.warn('[push] dropped expired subscriptions'")
  })

  it('never logs the endpoint itself — it is a capability URL', () => {
    expect(src).toContain('function endpointHost(endpoint: string): string')
    expect(src).toContain('host:   endpointHost(sub.endpoint),')
    // The full endpoint must not reach a log line.
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*endpoint: sub\.endpoint/)
  })

  it('a payload that sanitises away to nothing is not silent either', () => {
    expect(src).toContain("console.warn('[push] dropped: empty after sanitisation'")
  })

  it('says nothing on the happy path', () => {
    // One line per delivered push would be ~1,700 lines per published
    // article. The only unconditional log statements are the failure ones.
    const logs = src.match(/console\.(log|warn|error)\(/g) ?? []
    expect(logs).toHaveLength(4)
    // All four sit on a failure branch: the config check, the empty-payload
    // drop, the non-expiry send error and the expiry cleanup. None runs for
    // a push that went out.
    expect(src).not.toMatch(/\.then\([^)]*console\./)
  })
})
