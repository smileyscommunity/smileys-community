import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const { id: eventId } = await params

    // Only approved attendees (or admins) can read the event chat
    if (session.role !== 'admin') {
      const attendee = await prisma.eventAttendee.findUnique({
        where: { userId_eventId: { userId: session.id, eventId } },
        select: { status: true },
      })
      if (attendee?.status !== 'approved') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const messages = await prisma.eventMessage.findMany({
      where: { eventId },
      include: {
        user: { select: { id: true, name: true, color: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(messages)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`event-msg:${session.id}`, 20, 60_000)) {
      return NextResponse.json({ error: 'Too many messages' }, { status: 429 })
    }

    const { id: eventId } = await params

    // Discussion auto-locks 14 days post-event (UI hides the input;
    // this is the server-side guard for the same window).
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { date: true } })
    if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const lockedAt = new Date(event.date); lockedAt.setDate(lockedAt.getDate() + 15)
    if (Date.now() >= lockedAt.getTime()) {
      return NextResponse.json({ error: 'Discussion closed for this event' }, { status: 403 })
    }

    // Only approved attendees (or admins) can post
    if (session.role !== 'admin') {
      const attendee = await prisma.eventAttendee.findUnique({
        where: { userId_eventId: { userId: session.id, eventId } },
        select: { status: true },
      })
      if (attendee?.status !== 'approved') {
        return NextResponse.json({ error: 'You must be an approved attendee to message' }, { status: 403 })
      }
    }

    const { message } = await req.json()
    if (!message?.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 })
    if (message.trim().length > 2000) return NextResponse.json({ error: 'Message too long (max 2000 chars)' }, { status: 400 })

    const created = await prisma.eventMessage.create({
      data: { eventId, userId: session.id, message: message.trim() },
      include: { user: { select: { id: true, name: true, color: true } } },
    })
    return NextResponse.json(created)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    const { id: eventId } = await params
    const { messageId } = await req.json()

    const [msg, attendee] = await Promise.all([
      prisma.eventMessage.findUnique({ where: { id: messageId } }),
      session.role !== 'admin'
        ? prisma.eventAttendee.findUnique({
            where: { userId_eventId: { userId: session.id, eventId } },
            select: { status: true },
          })
        : Promise.resolve(null),
    ])
    if (!msg || msg.eventId !== eventId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (session.role !== 'admin' && attendee?.status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (msg.userId !== session.id && session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.eventMessage.delete({ where: { id: messageId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
