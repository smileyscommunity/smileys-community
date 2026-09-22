import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-09-22, the day after push logging shipped and immediately showed the
// thing it was built to show: eleven expired subscriptions swept, and one
// FCM endpoint answering `500 permanent internal error encountered, do not
// retry the request.` — which we had been retrying on every broadcast for
// ever, because a 5xx normally means "try later".
//
// The failure underneath was that nothing put the device back. A push
// service retires a subscription and fires `pushsubscriptionchange`; with no
// handler the endpoint just rotted, the member stopped receiving anything,
// and nothing anywhere said so.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const push = src('lib/push.ts')
const sw   = src('public/sw.js')

describe('a subscription that will never deliver again', () => {
  it('goes when the service says gone, or says permanent', () => {
    expect(push).toContain("if (err?.statusCode === 404 || err?.statusCode === 410) return 'gone'")
    expect(push).toContain("if (typeof err?.body === 'string' && SAYS_PERMANENT.test(err.body)) return 'permanent'")
    expect(push).toContain('const dead = deadSubscription(err)')
    expect(push).toContain('if (dead) {')
  })

  it('is judged on the service\'s own words, not on the status — an outage is temporary', () => {
    const re = /const SAYS_PERMANENT = (\/.*\/[a-z]*)/.exec(push)
    expect(re).toBeTruthy()
    const rx = new RegExp(re![1].slice(1, re![1].lastIndexOf('/')), re![1].slice(re![1].lastIndexOf('/') + 1))
    // What FCM actually answered, verbatim from the production log.
    expect(rx.test('permanent internal error encountered, do not retry the request.\n')).toBe(true)
    // A plain 500 during an outage keeps the member's subscription.
    expect(rx.test('Internal Server Error')).toBe(false)
    expect(rx.test('<html>502 Bad Gateway</html>')).toBe(false)
  })

  it('says so distinctly, so a permanent drop is not read as ordinary expiry', () => {
    expect(push).toContain("console.warn('[push] subscription declared permanently broken', {")
    // The endpoint is a capability URL; only its host is ever logged.
    expect(push).toContain('host: endpointHost(sub.endpoint), status: err?.statusCode ?? null,')
  })
})

describe('the device puts itself back', () => {
  it('the worker re-registers when the push service rotates a subscription', () => {
    expect(sw).toContain("self.addEventListener('pushsubscriptionchange', e => {")
    expect(sw).toContain('let sub = e.newSubscription ?? null')
    // The VAPID key comes from the old subscription, so this static file
    // never carries one.
    expect(sw).toContain('? e.oldSubscription.options.applicationServerKey')
    expect(sw).toContain('sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })')
    expect(sw).toContain("await fetch('/app/api/push/subscribe', {")
    expect(sw).toContain('JSON.stringify({ ...sub.toJSON(), replaces: previous }),')
  })

  it('gives up rather than storing a dud when there is no key to re-subscribe with', () => {
    expect(sw).toContain('if (!key) return')
  })

  it('and the rotated-away row goes with it, scoped to its owner', () => {
    const route = src('app/api/push/subscribe/route.ts')
    expect(route).toContain("const replaces = typeof body?.replaces === 'string' ? body.replaces : null")
    expect(route).toContain('if (replaces && replaces !== endpoint) {')
    expect(route).toContain('where: { endpoint: replaces, userId: session.id }')
  })
})
