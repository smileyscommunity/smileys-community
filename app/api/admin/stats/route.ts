import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canViewAnalytics } from '@/lib/access'
import { todayIstanbul } from '@/lib/data'

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

  return NextResponse.json({
    totalAccounts, members, hosts, events, upcoming, rsvps,
    newMembersThisMonth, revenueCollected, revenuePending, pendingPayments,
    pendingApplications, pendingReports,
    trends: {
      members: calcTrend(newMembersThisMonth, prevMembersMonth),
      rsvps:   calcTrend(rsvpsThisMonth, prevRsvpsMonth),
      revenue: calcTrend(revenueCollected, prevRevenue),
    },
    hangouts: {
      active:           hangoutsActive,
      today:            hangoutsToday,
      referencesWeek:   hangoutReferencesWeek,
    },
    // Oldest → newest, 7 days. Drives the dashboard RSVP sparkline.
    rsvpsByDay: rsvpsByDayCounts as number[],
  })
}
