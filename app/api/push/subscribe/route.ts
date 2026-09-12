import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// Every browser in use here delivers through one of these. Anything else is
// refused and logged, so a new vendor shows up in the log rather than
// silently failing — and so the server never POSTs to an arbitrary host.
const PUSH_HOSTS         = ['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com']
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.samsungosp.com']
const MAX_SUBSCRIPTIONS_PER_USER = 10

function isPushServiceEndpoint(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname.length < 2) return false
  const host = u.hostname.toLowerCase()
  const known = PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some(s => host.endsWith(s))
  if (!known) console.warn('[push/subscribe] endpoint host not on the allowlist', { host })
  return known
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`push-sub:${session.id}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const endpoint = body?.endpoint
  const keys     = body?.keys
  // lib/push later POSTs an encrypted payload to whatever is stored, so the
  // endpoint has to be a real push service — an https shape check still
  // let through internal hosts, IP literals and user:pass@ credentials.
  // Keys are base64url strings of bounded length.
  const isKey = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(v)
  if (!isPushServiceEndpoint(endpoint) || !isKey(keys?.p256dh) || !isKey(keys?.auth)) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } })
  if (existing && existing.userId !== session.id) {
    return NextResponse.json({ ok: true })
  }

  await prisma.pushSubscription.upsert({
    where:  { endpoint },
    create: { userId: session.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { p256dh: keys.p256dh, auth: keys.auth },
  })

  // A member has a handful of devices, not hundreds of rows: keep the newest.
  const surplus = await prisma.pushSubscription.findMany({
    where: { userId: session.id }, orderBy: { createdAt: 'desc' }, skip: MAX_SUBSCRIPTIONS_PER_USER, select: { id: true },
  })
  if (surplus.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: surplus.map(s => s.id) } } })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await req.json().catch(() => ({}))
  if (typeof endpoint !== 'string' || !endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 })

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: session.id },
  })

  return NextResponse.json({ ok: true })
}
