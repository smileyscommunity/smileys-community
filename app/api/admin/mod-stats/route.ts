import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canViewModStats } from '@/lib/access'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canViewModStats(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [
      pendingApplications,
      pendingReports,
      approvalQueueEvents,
      recentMessages,
      myEvents,
    ] = await Promise.all([
      prisma.memberApplication.count({ where: { status: 'pending' } }),
      prisma.report.count({ where: { status: 'pending' } }),
      prisma.event.count({ where: { status: 'pending' } }),
      prisma.eventMessage.findMany({
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
      recentMessages,
      myEvents,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
