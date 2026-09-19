import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { computeEventSurveyRollup, aggregateRollup } from '@/lib/survey'
import { heldEvents, steppedWouldReturn, SURVEY_STEP } from '@/lib/hostStats'

// GET /api/host/quality — the caller's own post-event survey signal.
// Same rollup admins see on /admin/users/[id], with deliberate
// omissions for the host-facing view:
//   - anomaly counts (safety flags are moderator-only; showing them to
//     the host would undermine the survey's anonymity promise)
//   - would-return rates only in whole blocks of SURVEY_STEP answers, per
//     event and overall, so neither a tiny sample nor the difference
//     between two readings gives away one attendee's answer
//     (lib/hostStats steppedWouldReturn has the full reasoning)
//
// Only events that went ahead and are over count (lib/hostStats
// heldEvents). This used to take every non-cancelled, non-draft event:
// "recent" was the six furthest in the future, and "across N events"
// counted next month's.
//
// Response: {
//   eventsHeld,
//   quality: null | { surveyResponses, wouldReturnRate, wouldReturnBasedOn, responseRate },
//   recent:  [{ id, title, emoji, date, responses, wouldReturnRate, wouldReturnBasedOn, responseRate }],
//   surveyStep,
// }
// wouldReturnBasedOn is how many of the responses the rate is built from;
// the rest wait for their block to fill.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const events = await heldEvents({ hostId: session.id })
  if (events.length === 0) {
    return NextResponse.json({ eventsHeld: 0, quality: null, recent: [], surveyStep: SURVEY_STEP })
  }
  const eventIds = events.map(e => e.id)

  const [rollups, answers] = await Promise.all([
    computeEventSurveyRollup(eventIds),
    prisma.eventSurvey.findMany({
      where:  { eventId: { in: eventIds } },
      select: { id: true, eventId: true, wouldReturn: true, createdAt: true },
    }),
  ])
  const agg     = aggregateRollup([...rollups.values()])
  const stepped = steppedWouldReturn(answers)

  const recent = events.slice(0, 6).map(e => {
    const r = rollups.get(e.id)
    const s = stepped.perEvent.get(e.id)
    return {
      id: e.id, title: e.title, emoji: e.emoji, date: e.date,
      responses:          r?.responses ?? 0,
      wouldReturnRate:    s?.rate ?? null,
      wouldReturnBasedOn: s?.basedOn ?? 0,
      responseRate:       r?.responseRate ?? null,
    }
  })

  return NextResponse.json({
    eventsHeld: events.length,
    quality: agg && {
      surveyResponses:    agg.totalResponses,
      wouldReturnRate:    stepped.overall.rate,
      wouldReturnBasedOn: stepped.overall.basedOn,
      responseRate:       agg.responseRate,
    },
    recent,
    surveyStep: SURVEY_STEP,
  })
}
