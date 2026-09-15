import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { disputeOffence } from '@/lib/standing'

type Params = { params: Promise<{ id: string }> }

// "I was there": a member disputes a no-show on their own record. It opens a
// moderator queue item (/admin/standing), and no card is issued to them while
// it waits (lib/standingPolicy decideIssuance).
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
    if (!await rateLimit(`standing-dispute:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const note = typeof body?.note === 'string' ? body.note : ''

    const outcome = await disputeOffence(id, session.id, note)
    if (outcome === 'ok')           return NextResponse.json({ ok: true })
    if (outcome === 'not_found')    return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (outcome === 'not_enforced') return NextResponse.json({ error: 'There is nothing to dispute yet' }, { status: 409 })
    return NextResponse.json({ error: 'This one can no longer be disputed' }, { status: 409 })
  } catch (e) {
    console.error('[standing dispute]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
