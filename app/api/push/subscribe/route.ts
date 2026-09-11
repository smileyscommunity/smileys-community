import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const endpoint = body?.endpoint
  const keys     = body?.keys
  // lib/push later POSTs an encrypted payload to whatever is stored, so the
  // endpoint has to be a real push-service URL (https) — a stored
  // http://10.0.0.5 endpoint was a blind server-side request on every
  // notification. Keys are base64url strings of bounded length.
  const isKey = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(v)
  if (typeof endpoint !== 'string' || !/^https:\/\/[^\s/]+\/.+/.test(endpoint) || endpoint.length > 2048 || !isKey(keys?.p256dh) || !isKey(keys?.auth)) {
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
