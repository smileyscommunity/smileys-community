import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canManageEventOps } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { rateLimit } from '@/lib/rateLimit'

const BROADCASTS_PER_HOUR = 10

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id: eventId } = await params
    const { message } = await req.json().catch(() => ({}))
    if (typeof message !== 'string') return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    if (!message.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    if (message.trim().length > 500) return NextResponse.json({ error: 'Message too long (max 500 chars)' }, { status: 400 })

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, hostId: true, clubId: true },
    })
    if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Same authority as the other participant ops (check-in, approve,
    // promote): admin, host, co-host, or a host of the event's club. This
    // route alone left co-hosts out, so they could run the door but not
    // tell the room.
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Counted only once the caller is known to run this event: a stranger's
    // (or a malformed) request used to burn the host's hourly budget.
    if (!isAdmin(session) && !await rateLimit(`broadcast:${session.id}`, BROADCASTS_PER_HOUR, 60 * 60_000)) {
      return NextResponse.json(
        { error: `You can send up to ${BROADCASTS_PER_HOUR} messages an hour to your guests — try again later` },
        { status: 429 },
      )
    }

    // `sent` is the number of people actually notified. The sender is
    // excluded in the query (a co-host attending counted themselves); so are
    // the accounts createNotification refuses to deliver to (banned, deleted
    // — lib/notify recipientSkipReason), which it reports as handled and the
    // count would have included; and a write that failed
    // (createNotification → false) isn't a message anyone got.
    const attendees = await prisma.eventAttendee.findMany({
      where: { eventId, status: 'approved', userId: { not: session.id }, user: { status: { notIn: ['banned', 'deleted'] } } },
      select: { userId: true },
    })

    const results = await Promise.all(
      attendees
        .map(a =>
          createNotification(
            a.userId,
            'host_message',
            `📢 ${event.title}`,
            message.trim(),
            `/events/${eventId}`,
          )
        )
    )

    return NextResponse.json({ ok: true, sent: results.filter(r => r !== false).length })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
