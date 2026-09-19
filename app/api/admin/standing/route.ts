import { NextRequest, NextResponse } from 'next/server'
import { maskRows } from '@/lib/admin/maskContact'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports, failClosedCityId } from '@/lib/access'
import { reviewConflict, eventRunners } from '@/lib/noShowPolicy'
import { LIVE_CARD_STATUSES, OffenceStatus, CardLevel, StandingCardStatus, windowStart } from '@/lib/standingPolicy'

// Standing queues for the admin panel. Moderators see their own city's members
// only (same scoping as the no-show inbox); admins see everything.
//   view=disputes  "I was there" waiting on a decision (the inbox)
//   view=review    red cards — eligible for review first, then still active
//   view=cards     every live card, shadow ones included
//   view=offences  the latest recorded offences
// One page of a queue. Returned with a `total` so a truncated list says so
// rather than quietly ending at the cap.
const PAGE = 200

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
      // The offences queue is the last 30 days, matching the tile that opens
      // it — it used to count 30 days and open an all-time list, so the number
      // and its destination disagreed. A dispute is never date-filtered:
      // somebody is waiting on it however old it is.
      const where = view === 'disputes'
        ? { status: OffenceStatus.Disputed, ...cityScope }
        : { recordedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, ...cityScope }
      const total = await prisma.standingOffence.count({ where })
      const rows = await prisma.standingOffence.findMany({
        where,
        orderBy: view === 'disputes' ? { disputedAt: 'asc' } : { recordedAt: 'desc' },
        take:    PAGE,
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
      // Warnings: what decideIssuance would count for this member right now —
      // counting, open, unattached to a card, inside the window. One of these
      // is a warning and nothing else; YELLOW_AFTER_OFFENCES of them is a card.
      // Counted here rather than in the page so it can never drift from the
      // rule that actually issues: same filter, same window.
      const userIds = [...new Set(rows.map(r => r.userId))]
      const loose = userIds.length ? await prisma.standingOffence.groupBy({
        by:    ['userId'],
        where: {
          userId:     { in: userIds },
          counts:     true,
          status:     OffenceStatus.Open,
          cardId:     null,
          occurredAt: { gte: windowStart(new Date()) },
        },
        _count: { _all: true },
      }) : []
      const warnings = new Map(loose.map(g => [g.userId, g._count._all]))

      const items = rows.map(({ event: { cohosts, club, ...event }, ...o }) => ({
        ...o, event,
        warnings: warnings.get(o.userId) ?? 0,
        conflict: reviewConflict(session.id, o, eventRunners({ hostId: event.hostId, cohosts, club })),
      }))
      return NextResponse.json({ items: maskRows(session, items, 'user'), total })
    }

    if (view === 'review' || view === 'cards') {
      const where = {
        ...(view === 'review'
          ? { level: CardLevel.Red, status: { in: [StandingCardStatus.Review, StandingCardStatus.Active] } }
          : { status: { in: LIVE_CARD_STATUSES } }),
        ...cityScope,
      }
      const total = await prisma.standingCard.count({ where })
      const rows = await prisma.standingCard.findMany({
        where,
        orderBy: [{ status: 'desc' }, { issuedAt: 'desc' }],
        take:    PAGE,
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
      return NextResponse.json({ items: maskRows(session, items, 'user'), total })
    }

    return NextResponse.json({ error: 'Unknown view' }, { status: 400 })
  } catch (e) {
    console.error('[admin standing]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
