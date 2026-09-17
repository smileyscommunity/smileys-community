import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageEventOps } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'
import { Attendance, AttendeeStatus } from '@/lib/constants'
import { eventStartsAt } from '@/lib/eventTime'
import { attendanceSettlesAt } from '@/lib/standingPolicy'
import { getCityTz } from '@/lib/city'
import { eventRunners } from '@/lib/noShowPolicy'
import { closeOutBlock, noShowCandidates, CLOSE_OUT_BLOCK_MESSAGE } from '@/lib/attendanceCloseOut'

type Params = { params: Promise<{ id: string }> }

// POST: mark the rest of the room as no-show. DELETE: undo it for the rows
// a close-out named. Who counts and when is lib/attendanceCloseOut.
//
// A record and nothing more here: the standing sweep turns a no-show into an
// offence when the room settles, at the end of the host's review day. A marked row misses the review ask, but
// the member can still review and still gets the post-event survey: only a
// settled no-show withholds those, so a host can't close out a room to keep
// its feedback away. A late arrival is checked in the normal way (PATCH
// ../checkin sets 'attended' over the mark).
//
// Both refuse a settled event (noShowProcessedAt), like the check-in PATCH:
// the v1 sweep turned its rows into cards, and rewriting attendance under a
// standing card is what that 409 exists to prevent.

const SETTLED = {
  error: 'Attendance for this event is already settled. To correct it, clear the no-show from the participants page.',
  code:  'attendance_settled',
}

export async function POST(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`checkin-closeout:${session.id}`, 20, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    if (event.noShowProcessedAt) return NextResponse.json(SETTLED, { status: 409 })

    const tz    = await getCityTz(event.cityId)
    const block = closeOutBlock(eventStartsAt(event, tz), attendanceSettlesAt(event, tz), new Date())
    if (block) return NextResponse.json({ error: CLOSE_OUT_BLOCK_MESSAGE[block], code: block }, { status: 409 })

    const rows = await prisma.eventAttendee.findMany({
      where:  { eventId, status: AttendeeStatus.Approved, checkedIn: false, attendance: Attendance.Unknown },
      select: { id: true, userId: true, status: true, checkedIn: true, attendance: true, user: { select: { role: true } } },
    })
    const ids = noShowCandidates(rows, eventRunners(event)).map(r => r.id)
    if (ids.length === 0) return NextResponse.json({ marked: [] })

    // The door's conditions ride in the write: someone scanned between the
    // read and here keeps their check-in, and a settlement can't be overwritten.
    await prisma.eventAttendee.updateMany({
      where: {
        id: { in: ids }, status: AttendeeStatus.Approved, checkedIn: false, attendance: Attendance.Unknown,
        event: { noShowProcessedAt: null, cancelledAt: null },
      },
      data:  { attendance: Attendance.NoShow },
    })
    const marked = (await prisma.eventAttendee.findMany({
      where:  { id: { in: ids }, eventId, checkedIn: false, attendance: Attendance.NoShow },
      select: { userId: true },
    })).map(r => r.userId)

    await writeAudit(session.id, session.name, 'event_no_shows_marked', eventId, 'event',
      { count: marked.length, userIds: marked, cityId: event.cityId },
      `Marked ${marked.length} no-show${marked.length === 1 ? '' : 's'} at "${event.title}"`)

    return NextResponse.json({ marked })
  } catch (e) {
    console.error('[checkin close-out POST]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!await rateLimit(`checkin-closeout:${session.id}`, 20, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const userIds: string[] = Array.isArray(body?.userIds)
      ? body.userIds.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0 && u.length <= 64).slice(0, 500)
      : []
    if (userIds.length === 0) return NextResponse.json({ error: 'userIds must be a non-empty list' }, { status: 400 })

    const event = await prisma.event.findUnique({
      where:  { id: eventId },
      select: { title: true, cityId: true, noShowProcessedAt: true, date: true, time: true, endTime: true },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.noShowProcessedAt) return NextResponse.json(SETTLED, { status: 409 })
    // The same window as marking: once it closes, attendance stays as it was left.
    const tz    = await getCityTz(event.cityId)
    const block = closeOutBlock(eventStartsAt(event, tz), attendanceSettlesAt(event, tz), new Date())
    if (block) return NextResponse.json({ error: CLOSE_OUT_BLOCK_MESSAGE[block], code: block }, { status: 409 })

    // Only marks still standing: a row checked in since is 'attended' and
    // stays so. Read first, so the audit names the rows that changed rather
    // than whatever ids the request carried.
    const rows = await prisma.eventAttendee.findMany({
      where:  { eventId, userId: { in: userIds }, status: AttendeeStatus.Approved, checkedIn: false, attendance: Attendance.NoShow },
      select: { id: true, userId: true },
    })
    if (rows.length === 0) return NextResponse.json({ cleared: 0 })
    const { count } = await prisma.eventAttendee.updateMany({
      where: {
        id: { in: rows.map(r => r.id) }, status: AttendeeStatus.Approved, checkedIn: false, attendance: Attendance.NoShow,
        event: { noShowProcessedAt: null },
      },
      data:  { attendance: Attendance.Unknown },
    })

    await writeAudit(session.id, session.name, 'event_no_shows_cleared', eventId, 'event',
      { count, userIds: rows.map(r => r.userId), cityId: event.cityId },
      `Cleared ${count} no-show${count === 1 ? '' : 's'} at "${event.title}"`)

    return NextResponse.json({ cleared: count })
  } catch (e) {
    console.error('[checkin close-out DELETE]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
