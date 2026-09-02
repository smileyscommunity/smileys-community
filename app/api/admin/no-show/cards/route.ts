import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports, failClosedCityId } from '@/lib/access'

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
        ...(isAdmin(session) ? {} : { user: { cityId: failClosedCityId(session) } }),
      },
      orderBy: [{ appealedAt: 'desc' }, { issuedAt: 'desc' }],
      take: 200,
      include: {
        user:  { select: { id: true, name: true, email: true, cityId: true } },
        event: { select: { id: true, title: true, emoji: true, date: true, hostId: true } },
      },
    })
    return NextResponse.json({ cards })
  } catch (e) {
    console.error('[admin no-show cards]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
