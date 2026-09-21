import webpush from 'web-push'
import { prisma } from './prisma'

// Configured on first send, not on import. web-push throws from
// setVapidDetails when the keys are absent, so doing it at module scope made
// merely IMPORTING anything that transitively reaches this file fail without
// VAPID in the environment — which is every unit test of a route that happens
// to sit downstream of a notification. A push module should be inert until
// someone pushes.
let vapidReady = false
// Said once per process, not once per send: without keys EVERY push is a
// silent no-op, and the only evidence was members reporting they got
// nothing. One line at startup beats a database query later.
let vapidWarned = false
function configureVapid(): boolean {
  if (vapidReady) return true
  const { VAPID_EMAIL, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_EMAIL || !NEXT_PUBLIC_VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    if (!vapidWarned) {
      vapidWarned = true
      console.error('[push] VAPID is not configured — no push notification will be delivered', {
        VAPID_EMAIL: !!VAPID_EMAIL,
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: !!NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: !!VAPID_PRIVATE_KEY,
      })
    }
    return false
  }
  webpush.setVapidDetails(VAPID_EMAIL, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  vapidReady = true
  return true
}

// An endpoint is a capability URL — whoever holds it can push to that device
// — so only its host goes in a log line.
function endpointHost(endpoint: string): string {
  try { return new URL(endpoint).host } catch { return 'unparseable' }
}

// Hard caps on payload field lengths. Browsers / push services cap the
// total encrypted payload at ~4KB; staying well under means we never
// silently fail on a legit notification because some caller stuffed a
// long event title in the body. Also: long strings would just truncate
// in the notification UI, so there's no reason to allow them.
const MAX_TITLE = 80
const MAX_BODY  = 200
const MAX_LINK  = 500
// Per-user fan-out cap. A pathological user with N stale subscriptions
// would otherwise issue N web-push calls per notification. Real users
// have 1–3 devices; the stale-cleanup path in this file drops 404/410s
// so a healthy user stays well under the cap. Truncate before send as
// a defense-in-depth rate limit.
const MAX_SUBS_PER_SEND = 20

// Strip control chars + zero-width / bidi unicode that could mess up the
// notification renderer or be used to spoof the visible content
// (RTL override is a classic confusable trick). Allow standard letters,
// numbers, punctuation, emoji, and whitespace.
function sanitizeText(s: string, max: number): string {
  // Strip the dangerous-only set:
  //   \u200b ZWSP, \u200e LRM, \u200f RLM, \u202a-\u202e bidi overrides,
  //   \u2066-\u2069 isolates, \ufeff BOM.
  // KEEP \u200c (ZWNJ) and \u200d (ZWJ) \u2014 those are required for correct
  // rendering of Persian / Urdu / Hindi / Bengali and for compound emoji
  // (family glyphs like \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 are sequences glued by ZWJ).
  // eslint-disable-next-line no-control-regex
  const stripped = s
    .replace(/[\x00-\x1f\x7f]/g, '')                                  // ASCII control chars
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim()
  // Truncate by code point, not UTF-16 code unit. slice(0, max) on a string
  // ending at an emoji boundary leaves a lone surrogate, which the OS
  // notification renderer shows as U+FFFD.
  const codePoints = Array.from(stripped)
  return codePoints.length > max ? codePoints.slice(0, max).join('') : stripped
}

// Only allow links that stay inside the app. Without this, a host who
// controls some user-supplied string flowing into a push could direct
// the recipient to `javascript:`, `https://evil.com`, etc. (The SW's
// notificationclick handler already normalizes, but defense in depth
// is cheap.)
function sanitizeLink(link: string | undefined): string | undefined {
  if (!link) return undefined
  const s = link.trim().slice(0, MAX_LINK)
  // Allow only same-origin paths. Reject `//foo` (protocol-relative),
  // schemes, and any whitespace / control chars.
  if (/[\s\x00-\x1f]/.test(s)) return undefined
  if (s.startsWith('//')) return undefined
  if (/^[a-z]+:/i.test(s)) return undefined  // strips http:, https:, javascript:, mailto: etc.
  if (!s.startsWith('/')) return undefined   // require absolute path
  return s
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; link?: string },
) {
  // No keys, no push — and no throw. Callers are fire-and-forget; a missing
  // VAPID config must not take down whatever triggered the notification.
  if (!configureVapid()) return
  const subs = await prisma.pushSubscription.findMany({
    // A banned member's devices (account deletion bans too) get nothing: the
    // ban ended that contact. Filtered through the relation so the check costs
    // no extra round trip on the hot path. Suspension is decided per type in
    // lib/notify, which is where the type is known.
    where:   { userId, user: { status: { notIn: ['banned', 'deleted'] } } },
    orderBy: { createdAt: 'desc' },
    take:    MAX_SUBS_PER_SEND,
  })
  if (!subs.length) return

  // Sanitize at send time. Sanitizing at every caller would mean every
  // route that touches push has to remember to do it; bake it in here.
  const safeTitle = sanitizeText(payload.title, MAX_TITLE)
  const safeBody  = sanitizeText(payload.body,  MAX_BODY)
  const safeLink  = sanitizeLink(payload.link)
  if (!safeTitle || !safeBody) {
    // A caller passed something that sanitised away to nothing. The member
    // gets no push and nothing else would ever say why.
    console.warn('[push] dropped: empty after sanitisation', { userId, title: payload.title.slice(0, 40) })
    return
  }

  const data = JSON.stringify({
    title: safeTitle,
    body:  safeBody,
    link:  safeLink,
  })
  const stale: string[] = []

  await Promise.allSettled(
    subs.map(sub =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data,
        )
        .catch((err: { statusCode?: number; body?: string; message?: string }) => {
          // 404/410 means the subscription expired — mark for cleanup
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            stale.push(sub.id)
            return
          }
          // Everything else was swallowed whole: a rejected VAPID signature
          // (401/403), an oversized payload (413), a throttled or broken push
          // service (429/5xx) all looked exactly like a delivered push. These
          // are rare by nature, so one line each is the right volume — and the
          // first thing to read when someone says the push never arrived.
          console.error('[push] send failed', {
            userId,
            host:   endpointHost(sub.endpoint),
            status: err?.statusCode ?? null,
            error:  (err?.body ?? err?.message ?? '').toString().slice(0, 200),
          })
        }),
    ),
  )

  if (stale.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: stale } } })
    // The device is gone for good — that is why a member's push count drops
    // without anyone touching the settings toggle.
    console.warn('[push] dropped expired subscriptions', { userId, count: stale.length })
  }
}
