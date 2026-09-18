import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator, failClosedCityId } from '@/lib/access'
import { attendanceReviewRows } from '@/lib/attendanceReview'

export const dynamic = 'force-dynamic'

/**
 * The attendance review queue. Admins see every room the standing sweep is
 * holding, a moderator their own city's (a city-less moderator matches
 * nothing); anyone else sees only the rooms they run — the
 * events they host, co-host, or host the club of (an inactive club grants
 * nothing, matching canManageEventOps).
 */
export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const all = isAdminOrModerator(session)
  const admin = isAdmin(session)
  let eventIds: string[] | undefined

  // Everyone but an admin gets the rooms they run; a moderator their city's too.
  if (!admin) {
    const [hosted, cohosted, clubs] = await Promise.all([
      prisma.event.findMany({ where: { hostId: session.id }, select: { id: true } }),
      prisma.eventCoHost.findMany({ where: { userId: session.id }, select: { eventId: true } }),
      prisma.clubMembership.findMany({
        where:  { userId: session.id, role: 'host', status: 'approved', club: { isActive: true } },
        select: { clubId: true },
      }),
    ])
    const clubEvents = clubs.length
      ? await prisma.event.findMany({ where: { clubId: { in: clubs.map(c => c.clubId) } }, select: { id: true } })
      : []
    eventIds = [...new Set([...hosted.map(e => e.id), ...cohosted.map(c => c.eventId), ...clubEvents.map(e => e.id)])]
    // Nothing to run: an empty allow-list must return nothing, never everything.
    if (eventIds.length === 0 && !all) return NextResponse.json({ rows: [], scope: 'mine' })
  }

  const rows = await attendanceReviewRows(new Date(), eventIds, all && !admin ? failClosedCityId(session) : undefined)
  return NextResponse.json({ rows, scope: all ? 'all' : 'mine' })
}
