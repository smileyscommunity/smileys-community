import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { getFirstEventRecommendations } from '@/lib/firstEvent'

// GET /api/first-event — the "Your First Event" invitation block.
// Returns up to `limit` ranked upcoming events in the member's city and
// logs each as an EventRecommendation for lift attribution. `empty` true
// means the whole city has nothing upcoming → UI shows the host-CTA state.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ events: [], empty: true })

  const raw = Number(new URL(req.url).searchParams.get('limit'))
  const limit = Number.isFinite(raw) && raw > 0 && raw <= 10 ? Math.floor(raw) : 3

  const events = await getFirstEventRecommendations(session.id, limit)

  if (events.length) {
    // Attribution only — never let a logging failure break the member surface.
    // One row per member per event per day: the block re-fetches on every
    // dashboard load, and logging each view grew the table past 21,000 rows
    // of the same three cards. The funnel only needs the first showing.
    const since  = new Date(Date.now() - 86_400_000)
    const logged = new Set((await prisma.eventRecommendation.findMany({
      where:  { userId: session.id, eventId: { in: events.map(e => e.id) }, createdAt: { gte: since } },
      select: { eventId: true },
    }).catch(() => [])).map(r => r.eventId))
    const fresh = events.filter(e => !logged.has(e.id))
    if (fresh.length) await prisma.eventRecommendation.createMany({
      data: fresh.map(e => ({
        userId:  session.id,
        eventId: e.id,
        score:   e.score,
        reason:  e.reason as unknown as Prisma.InputJsonValue,
        surface: 'first_event_block',
      })),
    }).catch(() => {})
  }

  return NextResponse.json({ events, empty: events.length === 0 })
}
