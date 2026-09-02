import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageEventOps } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { waiveCard } from '@/lib/noShow'

type Params = { params: Promise<{ id: string }> }

// A host clears a no-show card from THEIR event — the check-in was missed,
// the host made a mistake, the data was wrong. Authority is the same
// predicate as the door (canManageEventOps: admin, host, co-host, club
// host), and the card must belong to this event: a card id from someone
// else's event is a 404 here, whatever the caller may run elsewhere.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!await rateLimit(`no-show-waive:${session.id}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const body   = await req.json().catch(() => ({}))
    const cardId = typeof body?.cardId === 'string' ? body.cardId : ''
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 })
    if (reason.length < 3) return NextResponse.json({ error: 'A short reason is required' }, { status: 400 })

    const card = await prisma.noShowCard.findUnique({ where: { id: cardId }, select: { eventId: true } })
    if (!card || card.eventId !== eventId) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    const outcome = await waiveCard({ cardId, actor: { id: session.id, name: session.name }, reason })
    if (outcome === 'not_found')    return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    if (outcome === 'not_waivable') return NextResponse.json({ error: 'This card is already closed', code: outcome }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[no-show waive]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
