import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canViewAnalytics } from '@/lib/access'

// GET /api/admin/surveys
//
// Backs the Surveys tab on /admin/moderation. Returns:
//   - aggregate stats over the last 30 days + previous 30 days for
//     the trend arrow
//   - the most recent 50 survey responses with event context for the
//     scrollable list
//
// Three counts per window because Prisma's typed _sum doesn't expose
// Boolean columns; counted in parallel so wall time stays flat.
export async function GET() {
  const session = await getSession()
  if (!session || !canViewAnalytics(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now      = Date.now()
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
  const prevAgo  = new Date(now - 60 * 24 * 60 * 60 * 1000)

  const [
    total30, ret30, anom30,
    totalPrev, retPrev, anomPrev,
    totalAllTime, anomAllTime,
    recent,
  ] = await Promise.all([
    prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo }, wouldReturn: true } }),
    prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo }, anomaly: true } }),
    prisma.eventSurvey.count({ where: { createdAt: { gte: prevAgo, lt: monthAgo } } }),
    prisma.eventSurvey.count({ where: { createdAt: { gte: prevAgo, lt: monthAgo }, wouldReturn: true } }),
    prisma.eventSurvey.count({ where: { createdAt: { gte: prevAgo, lt: monthAgo }, anomaly: true } }),
    prisma.eventSurvey.count(),
    prisma.eventSurvey.count({ where: { anomaly: true } }),
    prisma.eventSurvey.findMany({
      orderBy: { createdAt: 'desc' },
      take:    50,
      // The userId is intentionally NOT selected — the survey's whole
      // wedge is that responders can flag safely. Admins never see
      // who said what about which event.
      select: {
        id: true, createdAt: true, anomaly: true, anomalyNote: true, wouldReturn: true,
        event: { select: { id: true, title: true, emoji: true, date: true, hostId: true } },
      },
    }),
  ])

  const rate30   = total30   > 0 ? Math.round((ret30   / total30)   * 100) : null
  const ratePrev = totalPrev > 0 ? Math.round((retPrev / totalPrev) * 100) : null

  return NextResponse.json({
    last30: {
      responses:        total30,
      wouldReturnRate:  rate30,
      anomalyRate:      total30 > 0 ? Math.round((anom30 / total30) * 100) : null,
      anomalies:        anom30,
      // Trend in percentage-points, not relative %.
      rateTrendPp:      (rate30 !== null && ratePrev !== null) ? rate30 - ratePrev : null,
    },
    allTime: {
      responses: totalAllTime,
      anomalies: anomAllTime,
    },
    recent,
  })
}
