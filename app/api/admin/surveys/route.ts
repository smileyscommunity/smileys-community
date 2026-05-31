import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateReports } from '@/lib/access'
import type { Prisma } from '@prisma/client'

// GET /api/admin/surveys
//
// Backs /admin/feedback. Two view shapes selected via `view`:
//
//   - `responses` (default) — paginated list of recent responses with
//     event context. Cursor-based on createdAt so load-more is O(1)
//     instead of OFFSET's perf cliff once the table grows.
//
//   - `events` — one row per event with at least one response,
//     aggregating responses + would-return rate + anomaly count.
//     Useful for "which events triggered the most feedback?"
//
// Always returns the 30d rollup so the rollup tile renders even when
// the filtered list is empty.
//
// Filters (apply to both views): anomalyOnly, from, to (yyyy-mm-dd
// inclusive), q (substring on anomalyNote), hostId.
//
// `format=csv` returns the full filtered response set as CSV. Same
// auth gate as JSON — admins + moderators only. userId stays
// server-side; the survey's wedge is responder anonymity.
//
// Auth: canModerateReports (admin OR moderator). Surveys ARE the
// upstream signal for the Reports moderators triage; locking this
// admin-only would force mods to react without seeing the data
// behind anomaly auto-files.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !canModerateReports(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const params = new URL(req.url).searchParams
  const view        = params.get('view') === 'events' ? 'events' : 'responses'
  const anomalyOnly = params.get('anomalyOnly') === '1'
  const fromStr     = params.get('from')?.trim() || null
  const toStr       = params.get('to')?.trim()   || null
  const q           = params.get('q')?.trim()    || null
  const hostId      = params.get('hostId')?.trim() || null
  const cursor      = params.get('cursor')?.trim() || null
  const take        = Math.min(Math.max(parseInt(params.get('take') ?? '50'), 1), 200)
  const format      = params.get('format') === 'csv' ? 'csv' : 'json'

  // Date filter shape — yyyy-mm-dd "from" is start-of-day, "to" is
  // end-of-day, both Istanbul time. Matches the apply-page presets.
  const createdAt: Prisma.DateTimeFilter = {}
  if (fromStr)  createdAt.gte = new Date(`${fromStr}T00:00:00+03:00`)
  if (toStr)    createdAt.lte = new Date(`${toStr}T23:59:59.999+03:00`)
  if (cursor)   createdAt.lt  = new Date(cursor)

  // Build a reusable where clause. Host filter dives into the event
  // relation; q matches anomalyNote substring case-insensitive.
  const where: Prisma.EventSurveyWhereInput = {}
  if (Object.keys(createdAt).length) where.createdAt = createdAt
  if (anomalyOnly) where.anomaly = true
  if (q)           where.anomalyNote = { contains: q, mode: 'insensitive' }
  if (hostId)      where.event = { is: { hostId } }

  // The 30d rollup ignores the active filters — it's the "is the
  // signal healthy overall?" header and should stay stable as you
  // narrow the list below.
  const now      = Date.now()
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
  const prevAgo  = new Date(now - 60 * 24 * 60 * 60 * 1000)
  const [total30, ret30, anom30, totalPrev, retPrev, totalAll, anomAll, hostsRaw] = await Promise.all([
    prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo }, wouldReturn: true } }),
    prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo }, anomaly: true } }),
    prisma.eventSurvey.count({ where: { createdAt: { gte: prevAgo, lt: monthAgo } } }),
    prisma.eventSurvey.count({ where: { createdAt: { gte: prevAgo, lt: monthAgo }, wouldReturn: true } }),
    prisma.eventSurvey.count(),
    prisma.eventSurvey.count({ where: { anomaly: true } }),
    // Distinct hosts who have at least one event with at least one
    // survey response — drives the host filter dropdown so it only
    // lists people whose events actually have data.
    prisma.eventSurvey.findMany({
      where:    {},
      select:   { event: { select: { hostId: true } } },
      distinct: ['eventId'],
    }),
  ])
  const rate30   = total30   > 0 ? Math.round((ret30   / total30)   * 100) : null
  const ratePrev = totalPrev > 0 ? Math.round((retPrev / totalPrev) * 100) : null

  const distinctHostIds = [...new Set(hostsRaw.map(r => r.event.hostId).filter((id): id is string => !!id))]
  const hosts = distinctHostIds.length > 0
    ? await prisma.user.findMany({
        where:   { id: { in: distinctHostIds } },
        select:  { id: true, name: true, color: true, profilePhoto: true },
        orderBy: { name: 'asc' },
      })
    : []

  const last30  = { responses: total30, wouldReturnRate: rate30, anomalyRate: total30 > 0 ? Math.round((anom30 / total30) * 100) : null, anomalies: anom30, rateTrendPp: (rate30 !== null && ratePrev !== null) ? rate30 - ratePrev : null }
  const allTime = { responses: totalAll, anomalies: anomAll }

  // ── Responses view ─────────────────────────────────────────────────────
  if (view === 'responses' && format === 'json') {
    const recent = await prisma.eventSurvey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    take + 1,  // +1 to detect hasMore without a second count
      select: {
        id: true, createdAt: true, anomaly: true, anomalyNote: true, wouldReturn: true,
        event: { select: { id: true, title: true, emoji: true, date: true, hostId: true } },
      },
    })
    const hasMore = recent.length > take
    const page    = hasMore ? recent.slice(0, take) : recent
    const nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null
    return NextResponse.json({ view: 'responses', last30, allTime, hosts, recent: page, hasMore, nextCursor })
  }

  // ── Events view ────────────────────────────────────────────────────────
  if (view === 'events' && format === 'json') {
    // Three groupBys (total + would-return-true + anomaly-true) over
    // the same filtered set; Prisma typed _sum doesn't expose Bools
    // so we reach for counts. Then enrich the top N with event meta.
    const [respGroups, retGroups, anomGroups] = await Promise.all([
      prisma.eventSurvey.groupBy({ by: ['eventId'], where,                                   _count: { _all: true } }),
      prisma.eventSurvey.groupBy({ by: ['eventId'], where: { ...where, wouldReturn: true }, _count: { _all: true } }),
      prisma.eventSurvey.groupBy({ by: ['eventId'], where: { ...where, anomaly: true },     _count: { _all: true } }),
    ])
    const retMap  = new Map(retGroups.map(r  => [r.eventId, r._count._all]))
    const anomMap = new Map(anomGroups.map(r => [r.eventId, r._count._all]))

    // Pull event meta for everything (we'll sort + slice in JS so we
    // can rank by `responses desc` without a Prisma orderBy on the
    // aggregate, which Postgres can do but Prisma's typed API can't
    // express cleanly).
    const eventIds = respGroups.map(g => g.eventId)
    const [events, attendeeGroups, cohostGroups] = await Promise.all([
      eventIds.length > 0
        ? prisma.event.findMany({
            where: { id: { in: eventIds } },
            select: { id: true, title: true, emoji: true, date: true, hostId: true },
          })
        : Promise.resolve([]),
      // eligibleAttendees is filter-independent: it's the event's
      // approved attendee pool minus 1 host minus cohosts. Filters
      // narrow which responses count toward the numerator, but the
      // denominator should stay stable so a "last 7 days" filter
      // reads as "% of eligible who responded within window".
      eventIds.length > 0
        ? prisma.eventAttendee.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds }, status: 'approved' }, _count: { _all: true } })
        : Promise.resolve([]),
      eventIds.length > 0
        ? prisma.eventCoHost.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds } }, _count: { _all: true } })
        : Promise.resolve([]),
    ])
    const evMap       = new Map(events.map(e => [e.id, e]))
    const attendeeMap = new Map(attendeeGroups.map(r => [r.eventId, r._count._all]))
    const cohostMap   = new Map(cohostGroups.map(r   => [r.eventId, r._count._all]))

    const rows = respGroups
      .map(g => {
        const responses = g._count._all
        const wouldRet  = retMap.get(g.eventId)  ?? 0
        const anomalies = anomMap.get(g.eventId) ?? 0
        const ev = evMap.get(g.eventId)
        const attendees = attendeeMap.get(g.eventId) ?? 0
        const cohosts   = cohostMap.get(g.eventId)   ?? 0
        const eligible  = Math.max(0, attendees - 1 - cohosts)
        return ev ? {
          event:           ev,
          responses,
          wouldReturnRate: responses > 0 ? Math.round((wouldRet / responses) * 100) : null,
          anomalyCount:    anomalies,
          eligibleAttendees: eligible,
          responseRate:    eligible > 0 ? Math.round((responses / eligible) * 100) : null,
        } : null
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
      .sort((a, b) => b.event.date.localeCompare(a.event.date))  // newest event first

    const page    = rows.slice(0, take)
    const hasMore = rows.length > take
    return NextResponse.json({ view: 'events', last30, allTime, hosts, events: page, hasMore, nextCursor: null })
  }

  // ── CSV export ─────────────────────────────────────────────────────────
  // Streams the full filtered response set (capped at 5000 so a
  // bare GET can't accidentally dump the whole DB to memory). userId
  // intentionally omitted — anonymity wedge.
  const CSV_CAP = 5000
  const rows = await prisma.eventSurvey.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take:    CSV_CAP,
    select: {
      id: true, createdAt: true, anomaly: true, anomalyNote: true, wouldReturn: true,
      event: { select: { id: true, title: true, date: true, hostId: true } },
    },
  })
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = ['response_id', 'created_at', 'event_id', 'event_title', 'event_date', 'event_host_id', 'would_return', 'anomaly', 'anomaly_note']
  const body   = rows.map(r => [
    r.id, r.createdAt.toISOString(),
    r.event.id, r.event.title, r.event.date, r.event.hostId ?? '',
    r.wouldReturn ? 'yes' : 'no',
    r.anomaly     ? 'yes' : 'no',
    r.anomalyNote ?? '',
  ].map(esc).join(','))
  const csv = [header.map(esc).join(','), ...body].join('\n')
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="smileys-feedback-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
