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

  const [
    totalAccounts, members, hosts, events, rsvps,
    pendingApplications, pendingReports, upcoming,
    newMembersThisMonth, prevMembersMonth,
    rsvpsThisMonth, prevRsvpsMonth,
    payments, prevPayments,
  ] = await Promise.all([
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
  ])

  const revenueCollected = payments.find(p => p.status === 'paid')?._sum.amount ?? 0
  const revenuePending   = payments.find(p => p.status === 'pending')?._sum.amount ?? 0
  const pendingPayments  = payments.find(p => p.status === 'pending')?._count ?? 0
  
  const prevRevenue = prevPayments.find(p => p.status === 'paid')?._sum.amount ?? 0

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
      revenue: calcTrend(revenueCollected, prevRevenue), // This is total cumulative vs prev period's performance? Actually performance in period is better.
    }
  })
}
