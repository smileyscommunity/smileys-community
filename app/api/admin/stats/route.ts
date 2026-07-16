import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canViewAnalytics } from '@/lib/access'
import { todayIstanbul } from '@/lib/data'
import { listStaleSweepers } from '@/lib/cronHealth'

export async function GET() {
  const session = await getSession()
  if (!session || !canViewAnalytics(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const todayStr = todayIstanbul()
  const now      = Date.now()
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const monthAgo   = new Date(now - thirtyDays)
  const prevMonth  = new Date(now - (thirtyDays * 2))
  const weekAgo    = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  // 7 daily buckets ending today (oldest first) — drives the RSVP sparkline
  // on the dashboard. Each entry is [start, end) of one calendar day so
  // we can count joinedAt within without overlap.
  const sevenDayBuckets: { start: Date; end: Date }[] = []
  for (let i = 6; i >= 0; i--) {
    const start = new Date(todayStart); start.setDate(start.getDate() - i)
    const end   = new Date(start);      end.setDate(end.getDate() + 1)
    sevenDayBuckets.push({ start, end })
  }

  const [
    totalAccounts, members, hosts, events, rsvps,
    pendingApplications, pendingReports, upcoming,
    newMembersThisMonth, prevMembersMonth,
    rsvpsThisMonth, prevRsvpsMonth,
    payments, prevPayments,
    hangoutsActive, hangoutsToday, hangoutReferencesWeek,
    topHostGroup, visitorsThisWeek,
    appsTotal, appsApproved, rsvpUserGroups,
    survey30d, surveyPrev30d,
    pendingJoinRequests, todayEventsRaw,
    ...rsvpsByDayCounts
  ] = await Promise.all<any>([
    prisma.user.count({ where: { role: { not: 'admin' } } }),
    prisma.user.count({ where: { status: 'approved', role: { in: ['member', 'moderator'] } } }),
    prisma.clubMembership.groupBy({ by: ['userId'], where: { role: 'host', status: 'approved' } }).then(r => r.length),
    prisma.event.count(),
    prisma.eventAttendee.count({ where: { status: 'approved', user: { role: { not: 'admin' } } } }),
    prisma.memberApplication.count({ where: { status: 'pending' } }),
    prisma.report.count({ where: { status: 'pending' } }),
    prisma.event.count({ where: { date: { gte: todayStr } } }),
    // Members growth
    prisma.user.count({ where: { status: 'approved', role: { not: 'admin' }, joinedAt: { gte: monthAgo } } }),
    prisma.user.count({ where: { status: 'approved', role: { not: 'admin' }, joinedAt: { gte: prevMonth, lt: monthAgo } } }),
    // RSVPs growth
    prisma.eventAttendee.count({ where: { status: 'approved', joinedAt: { gte: monthAgo } } }),
    prisma.eventAttendee.count({ where: { status: 'approved', joinedAt: { gte: prevMonth, lt: monthAgo } } }),
    // Revenue
    prisma.payment.groupBy({ by: ['status'], _sum: { amount: true }, _count: true }),
    prisma.payment.groupBy({ by: ['status'], where: { createdAt: { gte: prevMonth, lt: monthAgo } }, _sum: { amount: true } }),
    // Hangouts pulse — active (in-flight) hangouts, today's posts, and
    // references created in the last 7 days. References-this-week is the
    // best proxy for "is the trust loop actually firing?"
    prisma.hangout.count({ where: { status: 'active', endsAt: { gte: new Date() } } }),
    prisma.hangout.count({ where: { startsAt: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000) } } }),
    prisma.hangoutReference.count({ where: { createdAt: { gte: weekAgo } } }),
    // Top hangout host this week — surfaces the rising community
    // connector. groupBy + take=1 keeps it to a single query.
    prisma.hangout.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: weekAgo } },
      _count: { _all: true },
      orderBy: { _count: { userId: 'desc' } },
      take: 1,
    }),
    // Visitors arriving this week — soft alert pill on the dashboard.
    // Counts active announcements that start in the next 7 days.
    prisma.visitorAnnouncement.count({
      where: {
        status:   'active',
        startsOn: { gte: todayStr, lte: todayIstanbul(7) },
      },
    }),
    // Conversion funnel — applications → approved → first event → repeat.
    // Distinct-attendees-by-RSVP-count gives us the last two steps from a
    // single groupBy that we then filter in JS.
    prisma.memberApplication.count(),
    prisma.user.count({ where: { status: 'approved' } }),
    prisma.eventAttendee.groupBy({
      by:     ['userId'],
      where:  { status: 'approved', user: { role: { not: 'admin' } } },
      _count: { _all: true },
    }),
    // Post-event survey rollup — 30d window + previous-30d window
    // for a trend arrow. Three counts each (total, would-return-true,
    // anomaly-true) because Prisma's typed API doesn't expose _sum
    // on Boolean columns. Counted in the same Promise.all so wall
    // time stays flat.
    prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo } } })
      .then(async total => ({
        total,
        ret:  await prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo }, wouldReturn: true } }),
        anom: await prisma.eventSurvey.count({ where: { createdAt: { gte: monthAgo }, anomaly: true } }),
      })),
    prisma.eventSurvey.count({ where: { createdAt: { gte: prevMonth, lt: monthAgo } } })
      .then(async total => ({
        total,
        ret:  await prisma.eventSurvey.count({ where: { createdAt: { gte: prevMonth, lt: monthAgo }, wouldReturn: true } }),
        anom: await prisma.eventSurvey.count({ where: { createdAt: { gte: prevMonth, lt: monthAgo }, anomaly: true } }),
      })),
    // Join requests waiting for a decision on upcoming events — the
    // /admin/participants inbox's Pending count, surfaced as an alert
    // pill so requests don't sit unseen until someone opens that page.
    prisma.eventAttendee.count({
      where: { status: 'pending', event: { date: { gte: todayStr }, status: 'published' } },
    }),
    // Events running TODAY with going/checked-in counts — drives the
    // "happening today" hero. On event days the dashboard's top job is
    // door ops, not lifetime stats.
    prisma.event.findMany({
      where:   { date: todayStr, status: 'published' },
      orderBy: { time: 'asc' },
      select: {
        id: true, title: true, emoji: true, time: true, totalSpots: true,
        attendees: { where: { status: 'approved' }, select: { checkedIn: true } },
      },
    }),
    // RSVPs by day — 7 separate counts. Each runs against an indexed
    // (status, joinedAt) range so they're individually cheap; the
    // Promise.all parallelism keeps total wall-time low.
    ...sevenDayBuckets.map(b =>
      prisma.eventAttendee.count({
        where: { status: 'approved', joinedAt: { gte: b.start, lt: b.end } },
      }),
    ),
  ])

  // groupBy return types got widened to any by the Promise.all<any> cast
  // needed to mix in the dynamic ...sevenDayBuckets spread; re-narrow here.
  type PayBucket = { status: string; _sum: { amount: number | null }; _count?: number }
  const payArr  = payments as PayBucket[]
  const prevArr = prevPayments as PayBucket[]
  const revenueCollected = payArr.find(p => p.status === 'paid')?._sum.amount ?? 0
  const revenuePending   = payArr.find(p => p.status === 'pending')?._sum.amount ?? 0
  const pendingPayments  = payArr.find(p => p.status === 'pending')?._count ?? 0

  const prevRevenue = prevArr.find(p => p.status === 'paid')?._sum.amount ?? 0

  // Trends (percentage growth)
  const calcTrend = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? 100 : 0
    return Math.round(((curr - prev) / prev) * 100)
  }

  // Hydrate top hangout host's display fields (name + color) — separate
  // query because Prisma's groupBy can't include relations.
  const topHostId = topHostGroup?.[0]?.userId as string | undefined
  const topHostUser = topHostId
    ? await prisma.user.findUnique({ where: { id: topHostId }, select: { id: true, name: true, color: true, profilePhoto: true } })
    : null

  // Conversion funnel — derive distinct-counts from the rsvp groupBy.
  const groups       = (rsvpUserGroups ?? []) as { userId: string; _count: { _all: number } }[]
  const firstEvent   = groups.length
  const repeatEvent  = groups.filter(g => g._count._all >= 2).length

  // #4: email-failure count in the last 24h, surfaced on the
  // dashboard alerts row. Anything > 0 means SMTP/Resend is
  // probably broken and members are missing transactional emails.
  // Cheap query — indexed on createdAt.
  //
  // #5: sweeper health. listStaleSweepers walks the registered
  // sweeper names and returns any whose lastSuccessAt is older
  // than 2× their expected cadence (or never recorded). Tiny
  // table, so the read is cheap.
  const [emailFailures24h, staleSweepers] = await Promise.all([
    prisma.emailFailure.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    listStaleSweepers(),
  ])

  return NextResponse.json({
    totalAccounts, members, hosts, events, upcoming, rsvps,
    newMembersThisMonth, revenueCollected, revenuePending, pendingPayments,
    pendingApplications, pendingReports, emailFailures24h,
    pendingJoinRequests: pendingJoinRequests as number,
    // Today's events with live door-ops counts, sorted by start time.
    todayEvents: (todayEventsRaw as { id: string; title: string; emoji: string; time: string; totalSpots: number; attendees: { checkedIn: boolean }[] }[])
      .map(e => ({
        id: e.id, title: e.title, emoji: e.emoji, time: e.time, totalSpots: e.totalSpots,
        going:     e.attendees.length,
        checkedIn: e.attendees.filter(a => a.checkedIn).length,
      })),
    staleSweepers: staleSweepers.map(s => s.name),
    trends: {
      members: calcTrend(newMembersThisMonth, prevMembersMonth),
      rsvps:   calcTrend(rsvpsThisMonth, prevRsvpsMonth),
      revenue: calcTrend(revenueCollected, prevRevenue),
    },
    hangouts: {
      active:         hangoutsActive,
      today:          hangoutsToday,
      referencesWeek: hangoutReferencesWeek,
      // Top host this week — null when nobody posted any hangouts in the
      // window. Render conditionally on the client.
      topHost: topHostUser ? {
        ...topHostUser,
        count: topHostGroup[0]._count._all as number,
      } : null,
    },
    visitorsThisWeek,
    funnel: {
      applications: appsTotal      as number,
      approved:     appsApproved   as number,
      firstEvent,
      repeat:       repeatEvent,
    },
    // Post-event survey quality signal (last 30d + previous 30d for
    // a trend arrow). Null wouldReturnRate when no responses in the
    // window — UI renders "—" instead of a misleading 0%.
    quality: (() => {
      const cur  = survey30d     as { total: number; ret: number; anom: number }
      const prev = surveyPrev30d as { total: number; ret: number; anom: number }
      const rate     = cur.total  > 0 ? Math.round((cur.ret  / cur.total)  * 100) : null
      const prevRate = prev.total > 0 ? Math.round((prev.ret / prev.total) * 100) : null
      return {
        responses:       cur.total,
        anomalies:       cur.anom,
        wouldReturnRate: rate,
        anomalyRate:     cur.total > 0 ? Math.round((cur.anom / cur.total) * 100) : null,
        // Trend in percentage-points, not a percentage — "+3pp" reads
        // correctly for rates whereas calcTrend's relative %-change
        // would say "5%" for a 80→84pp shift, which is misleading.
        rateTrendPp:     (rate !== null && prevRate !== null) ? rate - prevRate : null,
        responsesTrend:  calcTrend(cur.total, prev.total),
      }
    })(),
    // Oldest → newest, 7 days. Drives the dashboard RSVP sparkline.
    rsvpsByDay: rsvpsByDayCounts as number[],
    // Deploy metadata — release is baked at build time (deploy.sh sets
    // APP_RELEASE=$(git rev-parse --short HEAD)); uptimeSeconds gives
    // time since pm2 restart ≈ time since deploy.
    release:        process.env.APP_RELEASE ?? null,
    uptimeSeconds:  Math.round(process.uptime()),
  })
}
