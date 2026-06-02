import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateMessages, isAdmin } from '@/lib/access'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !canModerateMessages(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const eventId = searchParams.get('eventId')

    // City-scope for moderators — admins see everything. Without this a
    // moderator could read every event's chat across every city, even though
    // the per-message DELETE handler at /admin/messages/[id] already does
    // re-check the event's cityId.
    const cityFilter = isAdmin(session)
      ? {}
      : { event: { cityId: session.cityId ?? '__none__' } }

    const messages = await prisma.eventMessage.findMany({
      where: { ...(eventId ? { eventId } : {}), ...cityFilter },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user:  { select: { id: true, name: true, email: true, color: true, role: true } },
        event: { select: { id: true, title: true } },
      },
    })

    return NextResponse.json(messages)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
