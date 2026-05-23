import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports } from '@/lib/access'
import { todayIstanbul } from '@/lib/data'

export async function GET() {
  const session = await getSession()
  if (!session || !canModerateReports(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const today = todayIstanbul()

  // Build last 6 months labels
  const months: { label: string; start: Date; end: Date }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
    months.push({ label: start.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), start, end })
  }

  const [users, pastEvents, payments, clubs] = await Promise.all([
    prisma.user.findMany({
      where: { role: { not: 'admin' } },
      select: { joinedAt: true, status: true },
    }),
    prisma.event.findMany({
      where: { date: { lt: today } },
      orderBy: { date: 'desc' },
      select: {
        id: true, title: true, emoji: true, date: true,
        totalSpots: true, clubId: true,
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
    }),
    prisma.payment.findMany({
      select: { amount: true, status: true, createdAt: true, eventId: true },
    }),
    prisma.club.findMany({
      select: {
        id: true, name: true, emoji: true, bgColor: true,
        _count: { select: { memberships: { where: { status: 'approved' } } } },
      },
    }),
  ])

  const paidPayments = payments.filter(p => p.status === 'paid')

  // Revenue per event
  const revenueByEvent: Record<string, number> = {}
  paidPayments.forEach(p => {
    revenueByEvent[p.eventId] = (revenueByEvent[p.eventId] ?? 0) + p.amount
  })

  // Revenue per club
  const revenueByClub: Record<string, number> = {}
  pastEvents.forEach(e => {
    if (e.clubId && revenueByEvent[e.id]) {
      revenueByClub[e.clubId] = (revenueByClub[e.clubId] ?? 0) + revenueByEvent[e.id]
    }
  })

  // Monthly new members
  const membersByMonth = months.map(m => ({
    label: m.label,
    count: users.filter(u => u.joinedAt >= m.start && u.joinedAt <= m.end).length,
  }))

  // Monthly revenue (paid)
  const revenueByMonth = months.map(m => ({
    label: m.label,
    amount: paidPayments
      .filter(p => p.createdAt >= m.start && p.createdAt <= m.end)
      .reduce((s, p) => s + p.amount, 0),
  }))

  // Past events ranked by fill %
  const rankedEvents = pastEvents
    .map(e => ({
      id: e.id, title: e.title, emoji: e.emoji, date: e.date,
      totalSpots: e.totalSpots,
      attended: e._count.attendees,
      fillPct: e.totalSpots > 0 ? Math.round((e._count.attendees / e.totalSpots) * 100) : 0,
      revenue: revenueByEvent[e.id] ?? 0,
    }))
    .sort((a, b) => b.fillPct - a.fillPct)
    .slice(0, 10)

  // Club leaderboard
  const clubStats = clubs.map(c => ({
    id: c.id, name: c.name, emoji: c.emoji, bgColor: c.bgColor,
    members: c._count.memberships,
    pastEvents: pastEvents.filter(e => e.clubId === c.id).length,
    avgFill: (() => {
      const ces = pastEvents.filter(e => e.clubId === c.id)
      if (!ces.length) return 0
      return Math.round(ces.reduce((s, e) => s + (e.totalSpots > 0 ? e._count.attendees / e.totalSpots : 0), 0) / ces.length * 100)
    })(),
    revenue: revenueByClub[c.id] ?? 0,
  })).sort((a, b) => b.members - a.members)

  // Summary stats (all historical)
  const totalPastEvents  = pastEvents.length
  const avgFillRate      = totalPastEvents > 0
    ? Math.round(pastEvents.reduce((s, e) => s + (e.totalSpots > 0 ? e._count.attendees / e.totalSpots : 0), 0) / totalPastEvents * 100)
    : 0
  const totalRevenue     = paidPayments.reduce((s, p) => s + p.amount, 0)
  const totalMembers     = users.filter(u => u.status === 'approved').length

  return NextResponse.json({
    summary: { totalMembers, totalPastEvents, avgFillRate, totalRevenue },
    membersByMonth,
    revenueByMonth,
    rankedEvents,
    clubStats,
  })
}
