import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canViewModStats, isAdmin } from '@/lib/access'
import { todayIstanbul } from '@/lib/data'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canViewModStats(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Badge counts must match the queues they lead to. Those queues are
    // city-scoped for moderators (fail-closed), so a network-wide count here
    // made a Bodrum moderator's sidebar say "3 reports" over an empty queue.
    // Admins keep the network view (their dashboard is the scoped stats route).
    const inCity        = isAdmin(session) ? {} : { cityId: session.cityId ?? '__no_city__' }
    const reportsInCity = isAdmin(session) ? {} : { reported: { is: { cityId: session.cityId ?? '__no_city__' } } }
    const msgInCity     = isAdmin(session) ? {} : { event: { is: { cityId: session.cityId ?? '__no_city__' } } }

    const [
      pendingApplications,
      pendingReports,
      approvalQueueEvents,
      visitorsThisWeek,
      recentMessages,
      myEvents,
    ] = await Promise.all([
      prisma.memberApplication.count({ where: { status: 'pending', ...(isAdmin(session) ? {} : { targetCityId: session.cityId ?? '__no_city__' }) } }),
      prisma.report.count({ where: { status: 'pending', ...reportsInCity } }),
      prisma.event.count({ where: { status: 'pending', ...inCity } }),
      // Visitors-this-week — mods see the same soft signal admins do so the
      // shared AlertsRow renders the same pill on both dashboards.
      prisma.visitorAnnouncement.count({
        where: {
          status:   'active',
          startsOn: { gte: todayIstanbul(), lte: todayIstanbul(7) },
          ...inCity,
        },
      }),
      prisma.eventMessage.findMany({
        where: msgInCity,
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          user:  { select: { id: true, name: true, color: true } },
          event: { select: { id: true, title: true } },
        },
      }),
      prisma.event.findMany({
        where: {
          hostId: session.id,
          status: 'published',
          date: { gte: new Date(new Date().toLocaleString('en-CA', { timeZone: 'Europe/Istanbul' }).split(',')[0]).toISOString().split('T')[0] },
        },
        orderBy: { date: 'asc' },
        take: 3,
        select: { id: true, title: true, date: true, time: true, spotsLeft: true, totalSpots: true, status: true },
      }),
    ])

    return NextResponse.json({
      pendingApplications,
      pendingReports,
      approvalQueueEvents,
      visitorsThisWeek,
      recentMessages,
      myEvents,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
