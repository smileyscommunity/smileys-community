import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { APP_URL } from '@/lib/env'

// Legacy mail clients surface the List-Unsubscribe URL as a plain link
// (GET). Nothing mutates here — redirect to the confirm page, which keeps
// scanner prefetches from opting anyone out.
export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get('uid') ?? ''
  const t   = req.nextUrl.searchParams.get('t') ?? ''
  return NextResponse.redirect(`${APP_URL}/unsubscribe?uid=${encodeURIComponent(uid)}&t=${encodeURIComponent(t)}`)
}

// The HMAC token in the email IS the authorization — no session involved,
// which is why middleware exempts this path from the CSRF origin check
// (RFC 8058 one-click POSTs come from mail providers' servers with no
// Origin header, same delivery shape as the Resend webhook).
async function unsubscribe(uid: string | null, t: string | null): Promise<boolean> {
  if (!uid || !t || !verifyUnsubscribeToken(uid, t)) return false
  // updateMany, not update: a deleted account's link should report success
  // (there is nothing to unsubscribe) rather than throw.
  await prisma.user.updateMany({ where: { id: uid }, data: { emailMarketing: false } })
  return true
}

// POST serves both callers: the confirm page's fetch (JSON body) and
// provider one-click (query params; the form body is the literal
// 'List-Unsubscribe=One-Click' and carries no fields we need).
export async function POST(req: NextRequest) {
  const ip = getIp(req)
  if (!await rateLimit(`unsub:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let uid = req.nextUrl.searchParams.get('uid')
  let t   = req.nextUrl.searchParams.get('t')
  if (!uid || !t) {
    const body = await req.json().catch(() => null)
    uid = typeof body?.uid === 'string' ? body.uid : null
    t   = typeof body?.t   === 'string' ? body.t   : null
  }

  if (!await unsubscribe(uid, t)) {
    return NextResponse.json({ error: 'Invalid unsubscribe link' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
