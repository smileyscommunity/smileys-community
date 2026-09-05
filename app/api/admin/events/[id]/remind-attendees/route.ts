import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canModerateReports } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { isFreeEvent } from '@/lib/noShowPolicy'
import { sendEventReminderEmail } from '@/lib/email'
import { formatDate } from '@/lib/data'
import { writeAudit } from '@/lib/audit'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session || (!isAdmin(session) && !canModerateReports(session))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    const event = await prisma.event.findUnique({
      where: { id },
      select: { id: true, title: true, emoji: true, date: true, location: true, cityId: true, price: true, memberPrice: true },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // Moderators are city-scoped; only admins can blast attendees of another
    // city's event. (canModerateReports above is the coarse role gate.)
    if (!isAdmin(session) && session.cityId !== event.cityId) {
      return NextResponse.json({ error: 'Cross-city moderation is admin-only' }, { status: 403 })
    }

    const today = new Date().toISOString().slice(0, 10)
    if (event.date < today) {
      return NextResponse.json({ error: 'Event has already happened' }, { status: 400 })
    }

    // Cap reminder blasts per event so this can't be used to email-bomb attendees.
    if (!await rateLimit(`remind-attendees:${id}`, 3, 60 * 60_000)) {
      return NextResponse.json({ error: 'Reminders were sent for this event recently — try again later.' }, { status: 429 })
    }

    const attendees = await prisma.eventAttendee.findMany({
      where: { eventId: id, status: 'approved' },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    if (attendees.length === 0) return NextResponse.json({ emailed: 0, notified: 0 })

    const eventDate     = formatDate(event.date)
    const eventLocation = event.location ?? ''
    const emoji         = event.emoji ?? '📅'

    let emailed = 0, notified = 0
    await Promise.all(attendees.map(async (a) => {
      const { user } = a
      await Promise.allSettled([
        sendEventReminderEmail(user.id, user.email, user.name, event.title, emoji, eventDate, eventLocation, event.id, { free: isFreeEvent(event) })
          .then(() => { emailed++ }),
        createNotification(
          user.id,
          'reminder_24h',
          `${emoji} ${event.title} is coming up!`,
          `Don't forget — ${event.title} is happening on ${eventDate}${eventLocation ? ` at ${eventLocation}` : ''}.`,
          `/events/${event.id}`,
        ).then(() => { notified++ }),
      ])
    }))

    await writeAudit(session.id, session.name, 'event.remind_attendees', event.id, 'event',
      { emailed, notified, attendees: attendees.length, cityId: event.cityId },
      `Sent reminders for "${event.title}" to ${attendees.length} attendees (${emailed} emailed, ${notified} notified)`,
    )

    return NextResponse.json({ emailed, notified })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
