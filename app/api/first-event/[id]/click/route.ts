import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { stampRecommendation } from '@/lib/eventRecommendations'

// POST /api/first-event/[id]/click — attribution beacon fired when a member
// taps a recommended event card. Stamps clickedAt on their recommendation for
// this event — the earliest row, which the duplicate prune never deletes (the
// most recent row it used to pick is exactly the one the prune removes).
// Best-effort: always 200 so a tracking hiccup never blocks navigation.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false })

  const { id: eventId } = await params

  await stampRecommendation(session.id, eventId, 'clickedAt').catch(() => {})

  return NextResponse.json({ ok: true })
}
