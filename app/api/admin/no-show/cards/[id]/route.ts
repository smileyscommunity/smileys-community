import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports } from '@/lib/access'
import { resolveCard, type ResolveAction } from '@/lib/noShow'

type Params = { params: Promise<{ id: string }> }

const ACTIONS: ResolveAction[] = ['accept', 'reject', 'overturn']

// Resolve a card: accept or reject its appeal, or overturn it outright.
// Moderators act only on members of their own city; admins anywhere.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || (!isAdmin(session) && !canModerateReports(session))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const body   = await req.json().catch(() => ({}))
    const action = body?.action as ResolveAction
    if (!ACTIONS.includes(action)) return NextResponse.json({ error: 'action must be accept, reject or overturn' }, { status: 400 })
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : undefined

    const card = await prisma.noShowCard.findUnique({ where: { id }, select: { user: { select: { cityId: true } } } })
    if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!isAdmin(session) && !canModerateReports(session, card.user.cityId)) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }

    const outcome = await resolveCard({ cardId: id, action, actor: { id: session.id, name: session.name }, note })
    if (outcome === 'not_found')   return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (outcome === 'not_pending') return NextResponse.json({ error: 'No pending appeal on this card', code: outcome }, { status: 409 })
    if (outcome === 'not_open')    return NextResponse.json({ error: 'This card is already closed', code: outcome }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin no-show resolve]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
