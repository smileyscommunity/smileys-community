import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { submitAppeal } from '@/lib/noShow'

type Params = { params: Promise<{ id: string }> }

// A member appeals their own red card. Only inside the appeal window, only
// once; the card sits in appeal_pending (nothing blocked) until an admin
// decides. The note is plain text, capped, stored as-is (rendered escaped).
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
    if (!await rateLimit(`no-show-appeal:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const note = typeof body?.note === 'string' ? body.note.trim() : ''
    if (note.length < 10) return NextResponse.json({ error: 'Tell us what happened (at least a sentence).' }, { status: 400 })
    if (note.length > 2000) return NextResponse.json({ error: 'Appeal is too long (max 2000 characters).' }, { status: 400 })

    const outcome = await submitAppeal(id, session.id, note)
    switch (outcome) {
      case 'ok':               return NextResponse.json({ ok: true })
      case 'not_found':        return NextResponse.json({ error: 'Card not found' }, { status: 404 })
      case 'already_appealed': return NextResponse.json({ error: 'This card has already been appealed', code: outcome }, { status: 409 })
      case 'window_closed':    return NextResponse.json({ error: 'The appeal window has closed', code: outcome }, { status: 409 })
      case 'not_appealable':   return NextResponse.json({ error: 'This card cannot be appealed', code: outcome }, { status: 409 })
    }
  } catch (e) {
    console.error('[no-show appeal]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
