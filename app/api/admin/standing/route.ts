import { NextRequest, NextResponse } from 'next/server'
import { maskRows } from '@/lib/admin/maskContact'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports, failClosedCityId } from '@/lib/access'
import { reviewConflict, eventRunners } from '@/lib/noShowPolicy'
import { LIVE_CARD_STATUSES, OffenceStatus, CardLevel, StandingCardStatus } from '@/lib/standingPolicy'

// Standing queues for the admin panel. Moderators see their own city's members
// only (same scoping as the no-show inbox); admins see everything.
//   view=disputes  "I was there" waiting on a decision (the inbox)
//   view=review    red cards — eligible for review first, then still active
//   view=cards     every live card, shadow ones included
//   view=offences  the latest recorded offences
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || (!isAdmin(session) && !canModerateReports(session))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const view      = req.nextUrl.searchParams.get('view') ?? 'disputes'
    const cityScope = isAdmin(session) ? {} : { user: { cityId: failClosedCityId(session) } }
    const userSelect = { id: true, name: true, email: true, cityId: true } as const

    if (view === 'disputes' || view === 'offences') {
      const rows = await prisma.standingOffence.findMany({
        where:   { ...(view === 'disputes' ? { status: OffenceStatus.Disputed } : {}), ...cityScope },
        orderBy: view === 'disputes' ? { disputedAt: 'asc' } : { recordedAt: 'desc' },
        take:    200,
        select: {
          id: true, userId: true, kind: true, tier: true, counts: true, loggedReason: true, status: true,
          occurredAt: true, recordedAt: true, disputeNote: true, disputedAt: true, resolutionNote: true,
          user:  { select: userSelect },
          event: { select: {
            id: true, title: true, emoji: true, date: true, cityId: true, hostId: true,
            // Only the viewer's own runner rows — enough to flag a conflict.
            cohosts: { where: { userId: session.id }, select: { userId: true } },
            club:    { select: { memberships: { where: { userId: session.id, role: 'host', status: 'approved' }, select: { userId: true } } } },
          } },
        },
      })
      const items = rows.map(({ event: { cohosts, club, ...event }, ...o }) => ({
        ...o, event,
        conflict: reviewConflict(session.id, o, eventRunners({ hostId: event.hostId, cohosts, club })),
      }))
      return NextResponse.json({ items: maskRows(session, items, 'user') })
    }

    if (view === 'review' || view === 'cards') {
      const rows = await prisma.standingCard.findMany({
        where: {
          ...(view === 'review'
            ? { level: CardLevel.Red, status: { in: [StandingCardStatus.Review, StandingCardStatus.Active] } }
            : { status: { in: LIVE_CARD_STATUSES } }),
          ...cityScope,
        },
        orderBy: [{ status: 'desc' }, { issuedAt: 'desc' }],
        take:    200,
        select: {
          id: true, userId: true, level: true, status: true, shadow: true, issuedAt: true, triggeredAt: true, resolutionNote: true,
          user:     { select: userSelect },
          _count:   { select: { recoveries: true } },
          offences: { orderBy: { occurredAt: 'asc' }, select: { id: true, kind: true, event: { select: { id: true, title: true, emoji: true, date: true } } } },
        },
      })
      const items = rows.map(({ _count, ...c }) => ({
        ...c, recoveries: _count.recoveries,
        conflict: c.userId === session.id ? 'own_card' as const : null,
      }))
      return NextResponse.json({ items: maskRows(session, items, 'user') })
    }

    return NextResponse.json({ error: 'Unknown view' }, { status: 400 })
  } catch (e) {
    console.error('[admin standing]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
