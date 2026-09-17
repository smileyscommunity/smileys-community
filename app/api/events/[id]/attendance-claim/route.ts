import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { rateLimit, claimOnce } from '@/lib/rateLimit'
import { Attendance, AttendeeStatus } from '@/lib/constants'
import { eventEndsAt } from '@/lib/eventTime'
import { getCityTz } from '@/lib/city'
import { eventRunners } from '@/lib/noShowPolicy'
import { attendanceSettlesAt } from '@/lib/standingPolicy'
import { saysCameKey } from '@/lib/standing'

type Params = { params: Promise<{ id: string }> }

// POST: a guest's "I was there", during the morning-after review. Direct
// messages need a connection and the discussion is public, so this is the
// one private line from an unchecked guest to the door: the roster shows
// "says they were there", and the people running it hear once. It decides
// nothing — the host checks them in, or doesn't.

export async function POST(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`attendance-claim:${session.id}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id: eventId } = await params
    const event = await prisma.event.findUnique({
      where:  { id: eventId },
      select: {
        title: true, emoji: true, cancelledAt: true, cityId: true, date: true, time: true, endTime: true, hostId: true,
        cohosts: { select: { userId: true } },
        club:    { select: { memberships: { where: { role: 'host', status: 'approved' }, select: { userId: true } } } },
      },
    })
    if (!event || event.cancelledAt) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const tz  = await getCityTz(event.cityId)
    const now = Date.now()
    if (now < eventEndsAt(event, tz).getTime()) {
      return NextResponse.json({ error: "The event hasn't ended yet — ask the host to check you in." }, { status: 409 })
    }
    if (now >= attendanceSettlesAt(event, tz).getTime()) {
      return NextResponse.json({ error: 'Attendance for this event is settled. If it counted as a no-show, dispute it from Your standing.', code: 'attendance_settled' }, { status: 409 })
    }

    const row = await prisma.eventAttendee.findUnique({
      where:  { userId_eventId: { userId: session.id, eventId } },
      select: { status: true, checkedIn: true, attendance: true },
    })
    if (!row || row.status !== AttendeeStatus.Approved) return NextResponse.json({ error: 'Not an attendee of this event' }, { status: 404 })
    if (row.checkedIn || row.attendance === Attendance.Attended) return NextResponse.json({ ok: true, already: 'checked_in' })
    if (row.attendance === Attendance.Excused) return NextResponse.json({ ok: true, already: 'excused' })

    // Once: the claim is what the roster reads, and the second tap tells nobody twice.
    if (!await claimOnce(saysCameKey(eventId, session.id), 7 * 86_400_000)) return NextResponse.json({ ok: true, already: 'said' })

    const runners = eventRunners(event)
    const door    = [...new Set([runners.hostId, ...runners.cohostIds, ...runners.clubHostIds].filter((u): u is string => !!u))]
    for (const userId of door) {
      createNotification(userId, 'attendance_claim', `${event.emoji} ${session.name} says they were at ${event.title}`,
        'They weren\'t checked in. If they came, check them in from the roster before midnight.',
        `/host/checkin?event=${eventId}`).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[attendance-claim POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
