import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { restoreRedCard } from '@/lib/standing'

type Params = { params: Promise<{ id: string }> }

// An admin's review of a red card. The review is the clearance and stays a
// human decision: three commitments make a member eligible, not restored.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    if (body?.action !== 'restore') return NextResponse.json({ error: 'action must be restore' }, { status: 400 })

    const card = await prisma.standingCard.findUnique({ where: { id }, select: { userId: true } })
    if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (card.userId === session.id) {
      return NextResponse.json({ error: 'Another admin has to review your own card' }, { status: 403 })
    }

    const outcome = await restoreRedCard({ cardId: id, admin: { id: session.id, name: session.name }, note: typeof body?.note === 'string' ? body.note : '' })
    if (outcome === 'ok')        return NextResponse.json({ ok: true })
    if (outcome === 'not_found') return NextResponse.json({ error: 'Not a red card' }, { status: 404 })
    return NextResponse.json({ error: 'This card is no longer live' }, { status: 409 })
  } catch (e) {
    console.error('[admin standing card]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
