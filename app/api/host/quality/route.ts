import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { computeEventSurveyRollup, aggregateRollup } from '@/lib/survey'

// GET /api/host/quality — the caller's own post-event survey signal.
// Same rollup admins see on /admin/users/[id], with two deliberate
// omissions for the host-facing view:
//   - anomaly counts (safety flags are moderator-only; showing them to
//     the host would undermine the survey's anonymity promise)
//   - per-event wouldReturn rates under MIN_RESPONSES, so a host can't
//     infer how a specific attendee answered on a tiny sample
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const MIN_RESPONSES = 3

  const events = await prisma.event.findMany({
    where:   { hostId: session.id, status: { notIn: ['cancelled', 'draft'] } },
    select:  { id: true, title: true, emoji: true, date: true },
    orderBy: { date: 'desc' },
  })
  if (events.length === 0) {
    return NextResponse.json({ eventsHosted: 0, quality: null, recent: [] })
  }

  const rollups = await computeEventSurveyRollup(events.map(e => e.id))
  const agg     = aggregateRollup([...rollups.values()])

  const recent = events.slice(0, 6).map(e => {
    const r = rollups.get(e.id)
    return {
      id: e.id, title: e.title, emoji: e.emoji, date: e.date,
      responses:       r?.responses ?? 0,
      wouldReturnRate: r && r.responses >= MIN_RESPONSES ? r.wouldReturnRate : null,
      responseRate:    r?.responseRate ?? null,
    }
  })

  return NextResponse.json({
    eventsHosted: events.length,
    quality: agg && {
      surveyResponses: agg.totalResponses,
      wouldReturnRate: agg.totalResponses >= MIN_RESPONSES ? agg.wouldReturnRate : null,
      responseRate:    agg.responseRate,
    },
    recent,
  })
}
