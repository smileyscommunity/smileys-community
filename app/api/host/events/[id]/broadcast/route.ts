import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { isClubHostFor } from '@/lib/access'
import { createNotification } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: eventId } = await params
    const { message } = await req.json()
    if (!message?.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    if (message.trim().length > 500) return NextResponse.json({ error: 'Message too long (max 500 chars)' }, { status: 400 })

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, hostId: true, clubId: true },
    })
    if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Must be the assigned host or an admin
    const isHost  = event.hostId === session.id || (event.clubId ? await isClubHostFor(session.id, event.clubId) : false)
    if (!isAdmin(session) && !isHost) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const attendees = await prisma.eventAttendee.findMany({
      where: { eventId, status: 'approved' },
      select: { userId: true },
    })

    await Promise.all(
      attendees
        .filter(a => a.userId !== session.id)
        .map(a =>
          createNotification(
            a.userId,
            'host_message',
            `Message from your host — ${event.title}`,
            message.trim(),
            `/events/${eventId}`,
          )
        )
    )

    return NextResponse.json({ ok: true, sent: attendees.length })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
