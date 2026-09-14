import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getFirstEventRecommendations } from '@/lib/firstEvent'
import { logRecommendations } from '@/lib/eventRecommendations'

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
    // One row per member per event, ever: the block re-fetches on every
    // dashboard load and the funnel only needs the first showing. The
    // per-member lock in logRecommendations stops concurrent loads both
    // inserting (the old unserialized read-then-insert did, ~71 rows a day).
    await logRecommendations(session.id, events).catch(() => {})
  }

  return NextResponse.json({ events, empty: events.length === 0 })
}
