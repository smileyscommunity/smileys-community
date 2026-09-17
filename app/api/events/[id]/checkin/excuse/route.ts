import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageEventOps } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'
import { Attendance, AttendeeStatus } from '@/lib/constants'
import { eventStartsAt } from '@/lib/eventTime'
import { getCityTz } from '@/lib/city'
import { eventRunners } from '@/lib/noShowPolicy'
import { attendanceSettlesAt } from '@/lib/standingPolicy'
import { canExcuse, closeOutBlock, CLOSE_OUT_BLOCK_MESSAGE } from '@/lib/attendanceCloseOut'

type Params = { params: Promise<{ id: string }> }

// POST { userId, excused }: the host's waiver in the morning-after review.
// Excused is neither attended nor a no-show — a guest who cancelled on
// WhatsApp, or had a reason the host accepts — and never becomes an offence.
// `excused: false` puts the row back to unmarked. Open from the start of the
// event until the room settles (attendanceSettlesAt), like close-out.

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`checkin-excuse:${session.id}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const userId  = body?.userId
    const excused = body?.excused
    if (typeof userId !== 'string' || userId.length === 0 || userId.length > 64) {
      return NextResponse.json({ error: 'userId must be a non-empty string' }, { status: 400 })
    }
    if (typeof excused !== 'boolean') return NextResponse.json({ error: 'excused must be a boolean' }, { status: 400 })

    const event = await prisma.event.findUnique({
      where:  { id: eventId },
      select: {
        title: true, status: true, cancelledAt: true, noShowProcessedAt: true,
        cityId: true, date: true, time: true, endTime: true, hostId: true,
        cohosts: { select: { userId: true } },
        club:    { select: { memberships: { where: { role: 'host', status: 'approved' }, select: { userId: true } } } },
      },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.cancelledAt || event.status === 'cancelled') {
      return NextResponse.json({ error: 'This event was cancelled — there is no attendance to record' }, { status: 400 })
    }
    if (event.noShowProcessedAt) {
      return NextResponse.json({ error: 'Attendance for this event is already settled.', code: 'attendance_settled' }, { status: 409 })
    }
    const tz    = await getCityTz(event.cityId)
    const block = closeOutBlock(eventStartsAt(event, tz), attendanceSettlesAt(event, tz), new Date())
    if (block) return NextResponse.json({ error: CLOSE_OUT_BLOCK_MESSAGE[block], code: block }, { status: 409 })

    const row = await prisma.eventAttendee.findUnique({
      where:  { userId_eventId: { userId, eventId } },
      select: { id: true, userId: true, status: true, checkedIn: true, attendance: true, user: { select: { name: true, role: true } } },
    })
    if (!row || row.status !== AttendeeStatus.Approved) {
      return NextResponse.json({ error: 'Not an approved attendee of this event' }, { status: 404 })
    }

    if (excused) {
      if (!canExcuse(row, eventRunners(event))) {
        return NextResponse.json({ error: row.checkedIn ? 'Already checked in' : 'Nothing to excuse for this guest' }, { status: 409 })
      }
    } else if (row.attendance !== Attendance.Excused) {
      return NextResponse.json({ attendance: row.attendance })
    }

    // The conditions ride in the write: a scan landing in between keeps its check-in.
    const { count } = await prisma.eventAttendee.updateMany({
      where: excused
        ? { id: row.id, status: AttendeeStatus.Approved, checkedIn: false, attendance: { in: [Attendance.Unknown, Attendance.NoShow] } }
        : { id: row.id, status: AttendeeStatus.Approved, checkedIn: false, attendance: Attendance.Excused },
      data:  { attendance: excused ? Attendance.Excused : Attendance.Unknown },
    })
    if (count === 0) return NextResponse.json({ error: 'That guest changed in the meantime — reload the roster.' }, { status: 409 })

    await writeAudit(session.id, session.name, excused ? 'event_guest_excused' : 'event_guest_unexcused', eventId, 'event',
      { userId, cityId: event.cityId, from: row.attendance },
      `${excused ? 'Excused' : 'Un-excused'} ${row.user?.name ?? 'a guest'} at "${event.title}"`)

    return NextResponse.json({ attendance: excused ? Attendance.Excused : Attendance.Unknown })
  } catch (e) {
    console.error('[checkin excuse POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
