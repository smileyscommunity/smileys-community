import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateEventQueue, isAdmin, failClosedCityId } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { maskRows } from '@/lib/admin/maskContact'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canModerateEventQueue(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!await rateLimit(`event-approval-queue:${session.id}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    // City-scope: moderators only see events in their own city. Admins
    // see the global queue. Matches the pattern already used in
    // /api/admin/applications and /api/admin/users.
    const cityFilter = isAdmin(session) ? {} : { cityId: failClosedCityId(session) }

    const events = await prisma.event.findMany({
      // A cancelled or archived event isn't waiting for review: offered here,
      // "Approve" published it again and announced it to the club.
      where: { approvalRequired: true, status: { notIn: ['cancelled', 'archived'] }, ...cityFilter },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, title: true, description: true, date: true, time: true,
        price: true, currency: true, totalSpots: true, status: true, approvalRequired: true,  // currency: priced in the event's own
        coverImage: true, address: true, neighborhood: true, createdAt: true,
        hostId: true,
        club: { select: { id: true, name: true } },
      },
    })

    const hostIds = [...new Set(events.map(e => e.hostId).filter(Boolean))] as string[]
    const hostUsers = hostIds.length
      ? await prisma.user.findMany({
          where: { id: { in: hostIds } },
          select: { id: true, name: true, email: true, color: true },
        })
      : []
    const hostMap = Object.fromEntries(hostUsers.map(u => [u.id, u]))

    const result = events.map(e => ({
      ...e,
      host: e.hostId ? (hostMap[e.hostId] ?? null) : null,
    }))

    // Host emails masked for moderators, as on every other moderator list.
    return NextResponse.json(maskRows(session, result, 'host'))
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
