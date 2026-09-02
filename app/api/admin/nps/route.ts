import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, isAdmin, failClosedCityId } from '@/lib/access'
import { periodFor, summarize, eligibilityCutoff, MIN_DAYS_FOR_NPS, type NPSRollup } from '@/lib/nps'

// GET /api/admin/nps
//
// Backs /admin/nps. Returns:
//
//   - current:    rollup for the current quarter
//   - history:    rollups for the last 4 quarters (oldest → newest)
//   - eligible:   approved members joined ≥ 30 days ago, for response-rate context
//   - comments:   the most recent free-text comments across all
//                 periods (capped at 50). userId stripped — admins
//                 see score + band + period only.
//
// Optional `period=YYYY-Qn` overrides current to inspect a past
// quarter in detail.
//
// `format=csv` returns the full anonymised response set (score,
// period, comment, createdAt) — userId never exposed. Same admin/
// moderator gate as JSON.
//
// Auth: admin OR moderator. NPS is a leadership-quality signal;
// moderators see it because they're already inside the trust
// envelope, but no individual response is ever attributable.

const HISTORY_QUARTERS = 4

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const params = new URL(req.url).searchParams
  const requestedPeriod = params.get('period')?.trim() || null
  const format          = params.get('format') === 'csv' ? 'csv' : 'json'

  const currentPeriod = requestedPeriod && /^\d{4}-Q[1-4]$/.test(requestedPeriod)
    ? requestedPeriod
    : periodFor()

  // Build the trailing-4 period set ending at currentPeriod.
  const periods = buildPeriodSet(currentPeriod, HISTORY_QUARTERS)
  // Moderators read their own city's responses (still anonymous — userId is
  // never returned); admins read the network.
  const cityScope = isAdmin(session) ? {} : { user: { cityId: failClosedCityId(session) } }

  // CSV branch — short-circuit before computing the rollup payload.
  if (format === 'csv') {
    const rows = await prisma.memberNPS.findMany({
      where:   { period: { in: periods }, ...cityScope },
      select:  { score: true, comment: true, period: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    5000,  // safety cap; trailing 4 quarters of healthy NPS shouldn't approach this
    })
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['period', 'score', 'band', 'created_at', 'comment']
    const body   = rows.map(r => [
      r.period, r.score,
      r.score >= 9 ? 'promoter' : r.score >= 7 ? 'passive' : 'detractor',
      r.createdAt.toISOString(),
      r.comment ?? '',
    ].map(esc).join(','))
    const csv = [header.map(esc).join(','), ...body].join('\n')
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="smileys-nps-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  const [rowsByPeriod, eligibleCount, comments] = await Promise.all([
    prisma.memberNPS.findMany({
      where:  { period: { in: periods }, ...cityScope },
      select: { score: true, period: true },
    }),
    prisma.user.count({ where: { status: 'approved', joinedAt: { lt: eligibilityCutoff() }, ...(isAdmin(session) ? {} : { cityId: failClosedCityId(session) }) } }),
    // Strip userId before returning. We surface score + comment +
    // period + createdAt — enough for the admin to read sentiment
    // and trend, never enough to identify the responder. Score
    // alone gives band-colouring on the row without the helper.
    prisma.memberNPS.findMany({
      where:   { comment: { not: null }, NOT: { comment: '' }, ...cityScope },
      select:  { id: true, score: true, comment: true, period: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    50,
    }),
  ])

  // Bucket rows by period for the summary pass.
  const byPeriod = new Map<string, { score: number }[]>()
  for (const p of periods) byPeriod.set(p, [])
  for (const r of rowsByPeriod) {
    byPeriod.get(r.period)?.push({ score: r.score })
  }

  const history: NPSRollup[]   = periods.map(p => summarize(p, byPeriod.get(p) ?? []))
  const current                = history[history.length - 1]
  const previous               = history.length >= 2 ? history[history.length - 2] : null
  const npsTrendPp             = (current.nps !== null && previous?.nps !== null && previous?.nps !== undefined)
    ? current.nps - (previous!.nps as number)
    : null

  // Response rate for the current period — context for "is 32 NPS
  // from 12 responses out of 240 eligible really signal?". Null
  // when nobody is eligible.
  const responseRate = eligibleCount > 0
    ? Math.round((current.responses / eligibleCount) * 100)
    : null

  return NextResponse.json({
    period:        currentPeriod,
    current,
    previous,
    npsTrendPp,
    history,
    eligible:      eligibleCount,
    responseRate,
    minDays:       MIN_DAYS_FOR_NPS,
    comments,
  })
}

// Walks back `count` periods from `endPeriod` inclusive. Used to
// build the trailing window for the trend chart.
function buildPeriodSet(endPeriod: string, count: number): string[] {
  const match = endPeriod.match(/^(\d{4})-Q([1-4])$/)
  if (!match) return [endPeriod]
  let year = parseInt(match[1], 10)
  let q    = parseInt(match[2], 10)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.unshift(`${year}-Q${q}`)
    q--
    if (q < 1) { q = 4; year-- }
  }
  return out
}
