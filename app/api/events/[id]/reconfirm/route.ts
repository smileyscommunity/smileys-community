import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { confirmAttendance } from '@/lib/reconfirm'
import { verifyReconfirmToken } from '@/lib/reconfirmToken'
import { APP_URL } from '@/lib/env'

type Params = { params: Promise<{ id: string }> }

// "Yes, I'm coming." Two doors to the same answer:
//   - the in-app button: POST with a session;
//   - the one-tap link in the email: GET, which only REDIRECTS to the event
//     page carrying the signed token — the page then POSTs it. Mail
//     scanners and link prefetchers fetch GETs on delivery; a GET that
//     confirmed on sight would mark members "coming" who never opened the
//     mail, then hand them a no-show card. Same reasoning as the
//     unsubscribe link. The token (HMAC over member+event) only ever sets a
//     timestamp on that member's own row for that one event.

const ID = /^[a-z0-9_-]{1,64}$/i

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: eventId } = await params
    if (!ID.test(eventId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const session = await getSession()

    const uid = typeof body?.uid === 'string' ? body.uid : ''
    const t   = typeof body?.t   === 'string' ? body.t   : ''
    const tokenUser = uid && t && verifyReconfirmToken(uid, eventId, t) ? uid : null
    const userId: string | null = session?.id ?? tokenUser
    if (!userId) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
    if (!await rateLimit(`reconfirm:${userId}:${getIp(req)}`, 20, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const outcome = await confirmAttendance(userId as string, eventId)
    if (outcome === 'ok') return NextResponse.json({ ok: true })
    if (outcome === 'released') return NextResponse.json({ error: 'That spot went to the waitlist — you can rejoin if one is open.', code: outcome }, { status: 409 })
    return NextResponse.json({ error: "You're not on this event", code: outcome }, { status: 404 })
  } catch (e) {
    console.error('[reconfirm POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: eventId } = await params
  if (!ID.test(eventId)) return NextResponse.redirect(`${APP_URL}/events`, 302)
  const uid = req.nextUrl.searchParams.get('uid') ?? ''
  const t   = req.nextUrl.searchParams.get('t')   ?? ''
  const eventPage = `${APP_URL}/events/${encodeURIComponent(eventId)}`
  if (!uid || !t || !verifyReconfirmToken(uid, eventId, t)) {
    return NextResponse.redirect(`${eventPage}?reconfirm=invalid`, 302)
  }
  // Nothing written here — see the note above.
  return NextResponse.redirect(`${eventPage}?reconfirm=prompt&uid=${encodeURIComponent(uid)}&t=${encodeURIComponent(t)}`, 302)
}
