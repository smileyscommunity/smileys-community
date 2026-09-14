import { NextRequest, NextResponse } from 'next/server'
import { maskRows } from '@/lib/admin/maskContact'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports, failClosedCityId } from '@/lib/access'
import { reviewConflict, eventRunners } from '@/lib/noShowPolicy'

// Cards inbox for the admin panel. Moderators see their own city's members
// only (same scoping as reports); admins see everything. `status` filters:
// appeal_pending (the default — that's the inbox), active, or all.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || (!isAdmin(session) && !canModerateReports(session))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const status = req.nextUrl.searchParams.get('status') ?? 'appeal_pending'
    const cards = await prisma.noShowCard.findMany({
      where: {
        ...(status === 'all' ? {} : { status }),
        // Your own cards aren't yours to judge (see cards/[id]).
        userId: { not: session.id },
        ...(isAdmin(session) ? {} : { user: { cityId: failClosedCityId(session) } }),
      },
      orderBy: [{ appealedAt: 'desc' }, { issuedAt: 'desc' }],
      take: 200,
      include: {
        user:  { select: { id: true, name: true, email: true, cityId: true } },
        event: { select: {
          id: true, title: true, emoji: true, date: true, hostId: true, cityId: true,  // cityId: the page formats card times on the event city's clock
          // Only the viewer's own runner rows — enough to flag a conflict, nothing about anyone else.
          cohosts: { where: { userId: session.id }, select: { userId: true } },
          club:    { select: { memberships: { where: { userId: session.id, role: 'host', status: 'approved' }, select: { userId: true } } } },
        } },
      },
    })
    // Cards from an event the viewer runs stay visible (the queue should show
    // what exists) but carry `conflict`, and the page offers no action on them;
    // cards/[id] refuses them regardless.
    const rows = cards.map(({ event: { cohosts, club, ...event }, ...c }) => ({
      ...c, event,
      conflict: reviewConflict(session.id, c, eventRunners({ hostId: event.hostId, cohosts, club })),
    }))
    return NextResponse.json({ cards: maskRows(session, rows, 'user') })
  } catch (e) {
    console.error('[admin no-show cards]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
