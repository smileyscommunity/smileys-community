import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// POST /api/first-event/[id]/click — attribution beacon fired when a member
// taps a recommended event card. Stamps clickedAt on their most recent
// un-clicked recommendation for this event. Best-effort: always 200 so a
// tracking hiccup never blocks navigation to the event.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false })

  const { id: eventId } = await params

  const rec = await prisma.eventRecommendation.findFirst({
    where: { userId: session.id, eventId, clickedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (rec) {
    await prisma.eventRecommendation.update({
      where: { id: rec.id },
      data: { clickedAt: new Date() },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
