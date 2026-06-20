import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateEventQueue, isAdmin } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'

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
    const cityFilter = isAdmin(session) ? {} : { cityId: session.cityId ?? '__none__' }

    const events = await prisma.event.findMany({
      where: { approvalRequired: true, ...cityFilter },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, title: true, description: true, date: true, time: true,
        price: true, totalSpots: true, status: true, approvalRequired: true,
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

    return NextResponse.json(result)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
