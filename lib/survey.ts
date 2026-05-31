import { prisma } from '@/lib/prisma'

// Shared rollup for post-event surveys. Five groupBys against the
// same eventIds set, reconciled into a single per-event payload that
// every admin surface can consume:
//
//   { responses, wouldReturnRate, anomalyCount, eligibleAttendees,
//     responseRate }
//
// responseRate = responses / eligibleAttendees * 100, null when the
// eligible pool is 0 (avoids "100% of nothing"). eligibleAttendees is
// approximated as `approved attendees - 1 host - cohost count`, which
// matches the dispatch cron's filter when host + all co-hosts are in
// the attendees list (the common case). When a host or co-host hasn't
// RSVPed, the approximation undercounts eligible by 1 per missing
// person — making the rate look slightly lower than reality, which
// is the conservative direction.
//
// Prisma's typed _sum doesn't expose Boolean columns; everywhere
// across the survey rollups we reach for counts with predicates.

export interface EventSurveyRollup {
  responses:         number
  wouldReturnRate:   number      // 0–100
  anomalyCount:      number
  eligibleAttendees: number      // approximation; see file header
  responseRate:      number | null  // null when eligibleAttendees === 0
}

export async function computeEventSurveyRollup(eventIds: string[]): Promise<Map<string, EventSurveyRollup>> {
  if (eventIds.length === 0) return new Map()

  const [respCounts, returnCounts, anomalyCounts, attendeeCounts, cohostCounts] = await Promise.all([
    prisma.eventSurvey.groupBy({   by: ['eventId'], where: { eventId: { in: eventIds } },                                  _count: { _all: true } }),
    prisma.eventSurvey.groupBy({   by: ['eventId'], where: { eventId: { in: eventIds }, wouldReturn: true },                _count: { _all: true } }),
    prisma.eventSurvey.groupBy({   by: ['eventId'], where: { eventId: { in: eventIds }, anomaly: true },                    _count: { _all: true } }),
    prisma.eventAttendee.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds }, status: 'approved' },               _count: { _all: true } }),
    prisma.eventCoHost.groupBy({   by: ['eventId'], where: { eventId: { in: eventIds } },                                  _count: { _all: true } }),
  ])

  const respMap     = new Map(respCounts.map(r     => [r.eventId, r._count._all]))
  const returnMap   = new Map(returnCounts.map(r   => [r.eventId, r._count._all]))
  const anomalyMap  = new Map(anomalyCounts.map(r  => [r.eventId, r._count._all]))
  const attendeeMap = new Map(attendeeCounts.map(r => [r.eventId, r._count._all]))
  const cohostMap   = new Map(cohostCounts.map(r   => [r.eventId, r._count._all]))

  const out = new Map<string, EventSurveyRollup>()
  for (const id of respMap.keys()) {
    const responses = respMap.get(id) ?? 0
    if (responses === 0) continue  // groupBy emits only non-zero anyway, defensive
    const wouldRet  = returnMap.get(id)   ?? 0
    const anomalies = anomalyMap.get(id)  ?? 0
    const attendees = attendeeMap.get(id) ?? 0
    const cohosts   = cohostMap.get(id)   ?? 0
    const eligible  = Math.max(0, attendees - 1 - cohosts)
    out.set(id, {
      responses,
      wouldReturnRate:   Math.round((wouldRet / responses) * 100),
      anomalyCount:      anomalies,
      eligibleAttendees: eligible,
      responseRate:      eligible > 0 ? Math.round((responses / eligible) * 100) : null,
    })
  }
  return out
}

// Aggregate rollup across a set of events (used by host/club quality
// cards). Returns null when no events have responses.
export interface AggregateSurveyRollup {
  eventsTracked:    number       // events with at least one response
  totalResponses:   number
  wouldReturnRate:  number | null
  anomalyCount:     number
  responseRate:     number | null
}

export function aggregateRollup(rows: EventSurveyRollup[]): AggregateSurveyRollup | null {
  if (rows.length === 0) return null
  const totalResponses    = rows.reduce((s, r) => s + r.responses,          0)
  const totalAnomalies    = rows.reduce((s, r) => s + r.anomalyCount,       0)
  const totalEligible     = rows.reduce((s, r) => s + r.eligibleAttendees,  0)
  // Weighted wouldReturnRate — sum of (rate * responses) over total
  // responses. Avoids the common "average of averages" mistake where
  // a tiny event with 100% would-return drags the headline up.
  const weightedReturnSum = rows.reduce((s, r) => s + (r.wouldReturnRate * r.responses), 0)
  return {
    eventsTracked:    rows.length,
    totalResponses,
    wouldReturnRate:  totalResponses > 0 ? Math.round(weightedReturnSum / totalResponses) : null,
    anomalyCount:     totalAnomalies,
    responseRate:     totalEligible  > 0 ? Math.round((totalResponses / totalEligible) * 100) : null,
  }
}
