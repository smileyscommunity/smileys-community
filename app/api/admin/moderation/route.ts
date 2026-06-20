import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateReports, isAdmin } from '@/lib/access'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canModerateReports(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Reports don't carry cityId directly; they're scoped via the
    // reported user's cityId. Moderators see only reports against
    // users in their own city. Admins see everything.
    const cityFilter = isAdmin(session) || !session.cityId
      ? {}
      : { reported: { is: { cityId: session.cityId } } }

    const reports = await prisma.report.findMany({
      where:   cityFilter,
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, name: true, email: true, color: true } },
        reported: { select: { id: true, name: true, email: true, color: true, status: true, role: true } },
      },
    })

    // Attach event title for reports that carry an eventId (e.g. post-event survey flags).
    const eventIds = [...new Set(reports.flatMap(r => r.eventId ? [r.eventId] : []))]
    const events = eventIds.length
      ? await prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } })
      : []
    const eventMap = new Map(events.map(e => [e.id, e]))

    return NextResponse.json(reports.map(r => ({
      ...r,
      event: r.eventId ? (eventMap.get(r.eventId) ?? null) : null,
    })))
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
