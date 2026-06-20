import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { sendNoShowEmail } from '@/lib/email'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session || (!isAdmin(session) && !canModerateReports(session))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    const event = await prisma.event.findUnique({
      where: { id },
      select: { id: true, title: true, emoji: true, date: true },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const today = new Date().toISOString().slice(0, 10)
    if (event.date >= today) {
      return NextResponse.json({ error: 'Event has not happened yet' }, { status: 400 })
    }

    const noShows = await prisma.eventAttendee.findMany({
      where: { eventId: id, status: 'approved', checkedIn: false },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    if (noShows.length === 0) {
      return NextResponse.json({ emailed: 0, notified: 0 })
    }

    let emailed = 0, notified = 0
    await Promise.all(noShows.map(async (a) => {
      const { user } = a
      await Promise.allSettled([
        sendNoShowEmail(user.id, user.email, user.name, event.title, event.emoji ?? '📅', event.id)
          .then(() => { emailed++ }),
        createNotification(
          user.id,
          'host_message',
          `We missed you at ${event.title} ${event.emoji ?? ''}`.trim(),
          `You were registered but didn't check in. Next time, please cancel your spot if you can't make it so others can join.`,
          `/events`,
        ).then(() => { notified++ }),
      ])
    }))

    return NextResponse.json({ emailed, notified })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
