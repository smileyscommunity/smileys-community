import webpush from 'web-push'
import { prisma } from './prisma'

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

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
  // eslint-disable-next-line no-control-regex
  return s
    .replace(/[\x00-\x1f\x7f]/g, '')          // ASCII control chars
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '') // ZWSP, bidi controls
    .trim()
    .slice(0, max)
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
  const subs = await prisma.pushSubscription.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    take:    MAX_SUBS_PER_SEND,
  })
  if (!subs.length) return

  // Sanitize at send time. Sanitizing at every caller would mean every
  // route that touches push has to remember to do it; bake it in here.
  const safeTitle = sanitizeText(payload.title, MAX_TITLE)
  const safeBody  = sanitizeText(payload.body,  MAX_BODY)
  const safeLink  = sanitizeLink(payload.link)
  if (!safeTitle || !safeBody) return  // empty after sanitization → drop

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
        .catch((err: { statusCode?: number }) => {
          // 404/410 means the subscription expired — mark for cleanup
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            stale.push(sub.id)
          }
        }),
    ),
  )

  if (stale.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: stale } } })
  }
}
