import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, canManageEventOps } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { rateLimit, claimOnce } from '@/lib/rateLimit'
import { Attendance } from '@/lib/constants'
import { eventStartsAt, eventEndsAt } from '@/lib/eventTime'
import { ATTENDANCE_AUTO_RESOLVE_HOURS } from '@/lib/standingPolicy'
import { getCityTz } from '@/lib/city'
import { eventRunners } from '@/lib/noShowPolicy'
import { isExemptFromNoShow } from '@/lib/attendanceCloseOut'

type Params = { params: Promise<{ id: string }> }

// How long before the doors the scanner wakes up. Twelve hours: the same
// line after which giving a spot back stops counting as giving it back, so
// the two halves of the no-show policy open and close together.
const CHECKIN_OPENS_HOURS_BEFORE = 12

// Shared predicate — see lib/access.canManageEventOps (adds co-hosts, one home).

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const attendees = await prisma.eventAttendee.findMany({
      where: { eventId, status: 'approved' },
      include: { user: { select: { id: true, name: true, color: true, email: true, profilePhoto: true, role: true } } },
      orderBy: { joinedAt: 'asc' },
    })

    // Privacy Masking: Only Admins and the Primary Host see emails. 
    // Co-hosts and Club Hosts only see Name/Photo for check-in.
    const event = await prisma.event.findUnique({
      where:  { id: eventId },
      select: {
        hostId:  true,
        cohosts: { select: { userId: true } },
        club:    { select: { memberships: { where: { role: 'host', status: 'approved' }, select: { userId: true } } } },
      },
    })
    const canSeeEmail = isAdmin(session) || event?.hostId === session.id

    // `exempt`: runs the event or is staff, so never a no-show — the roster
    // leaves them out of "mark the rest" (lib/attendanceCloseOut). The role
    // it is read from stays on the server.
    const runners = eventRunners(event)
    const mapped = attendees.map(a => {
      const { email, role, ...publicUser } = a.user
      return {
        ...a,
        exempt: isExemptFromNoShow(a.userId, role, runners),
        user:   canSeeEmail ? { ...publicUser, email } : publicUser,
      }
    })

    return NextResponse.json(mapped)
  } catch (e) {
    console.error('[checkin GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (!await rateLimit(`checkin-patch:${session.id}`, 120, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { userId, checkedIn } = await req.json()
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId must be a non-empty string' }, { status: 400 })
    }
    if (typeof checkedIn !== 'boolean') {
      return NextResponse.json({ error: 'checkedIn must be a boolean' }, { status: 400 })
    }

    // The door is only open while the event is. A cancelled event has no
    // door (400). A settled one (noShowProcessedAt) has a closed record:
    // the no-show pass has already turned the un-scanned rows into
    // 'no_show' and issued cards on them, so a toggle now would rewrite
    // `attendance` under a card that still stands — un-checking erased the
    // no_show mark, a late check-in stamped 'attended' beside an active
    // card. Both directions are refused (409) rather than half-applied: a
    // missed scan is corrected by clearing the card from the participants
    // page (waiveCard), which closes the card and keeps the trail.
    const event = await prisma.event.findUnique({
      where:  { id: eventId },
      select: { status: true, cancelledAt: true, noShowProcessedAt: true, cityId: true, date: true, time: true, endTime: true },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.cancelledAt || event.status === 'cancelled') {
      return NextResponse.json({ error: 'This event was cancelled — check-in is closed' }, { status: 400 })
    }
    if (event.noShowProcessedAt) {
      return NextResponse.json({
        error: 'Attendance for this event is already settled. To correct a missed scan, clear the no-show from the participants page.',
        code:  'attendance_settled',
      }, { status: 409 })
    }

    // Standing resolves the room a day after the end (lib/standing). Past that
    // line attendance is settled both ways, and a correction is a dispute a
    // moderator decides — not a scan, days later, by whoever runs the door.
    const tz = await getCityTz(event.cityId)
    if (Date.now() > eventEndsAt(event, tz).getTime() + ATTENDANCE_AUTO_RESOLVE_HOURS * 60 * 60_000) {
      return NextResponse.json({
        error: 'Attendance for this event is settled — check-in closed a day after it ended.',
        code:  'attendance_settled',
      }, { status: 409 })
    }

    // The door had no clock: a host could check the whole room in days
    // ahead, and the no-show sweep reads "half the room was scanned" as
    // proof check-in was really run — so everyone left unticked got a card.
    // Checking IN waits until CHECKIN_OPENS_HOURS_BEFORE the start, on the
    // event city's clock (a TBA time reads as midnight, so noon the day
    // before). Un-checking is a correction and stays open.
    if (checkedIn) {
      const startsAt = eventStartsAt(event, tz).getTime()
      const opensAt  = startsAt - CHECKIN_OPENS_HOURS_BEFORE * 60 * 60_000
      if (Number.isFinite(opensAt) && Date.now() < opensAt) {
        return NextResponse.json({
          error: `Check-in isn't open yet — it opens ${CHECKIN_OPENS_HOURS_BEFORE} hours before the event starts.`,
          code:  'checkin_not_open',
        }, { status: 409 })
      }
    }

    // Only a live, approved RSVP can be checked in — a cancelled row is
    // history and a pending one hasn't been let in yet. `attendance`
    // follows the toggle so the settled record and the door agree; the
    // post-event pass is what later turns an un-checked row into no_show.
    // The event conditions ride in the write too, so a settlement landing
    // between the read above and this update can't be overwritten.
    const { count } = await prisma.eventAttendee.updateMany({
      where: { userId, eventId, status: 'approved', event: { noShowProcessedAt: null, cancelledAt: null } },
      data:  { checkedIn, attendance: checkedIn ? Attendance.Attended : Attendance.Unknown },
    })
    if (count === 0) {
      return NextResponse.json({ error: 'Not an approved attendee of this event' }, { status: 404 })
    }
    const updated = await prisma.eventAttendee.findUnique({
      where: { userId_eventId: { userId, eventId } },
    })

    if (checkedIn) {
      const [event, checkedInUser, checkedInCount, totalCount] = await Promise.all([
        prisma.event.findUnique({
          where:  { id: eventId },
          select: { title: true, emoji: true, hostId: true },
        }),
        prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
        prisma.eventAttendee.count({ where: { eventId, status: 'approved', checkedIn: true } }),
        prisma.eventAttendee.count({ where: { eventId, status: 'approved' } }),
      ])

      if (event) {
        // Attendee: welcome notification
        createNotification(
          userId,
          'checkin',
          `${event.emoji} You're checked in!`,
          `Welcome to ${event.title}. Enjoy the event!`,
          `/events/${eventId}`,
        ).catch(() => {})

        // Host: live count update (skip if the host is checking themselves in)
        if (event.hostId && event.hostId !== userId) {
          createNotification(
            event.hostId,
            'checkin_count',
            `${event.emoji} ${checkedInUser?.name ?? 'Someone'} just checked in`,
            `${checkedInCount}/${totalCount} checked in to ${event.title}`,
            `/host/checkin?event=${eventId}`,
          ).catch(() => {})
        }

        // On first check-in: notify admins + all other approved attendees
        // that doors are open. "Count is 1 after the write" replayed it every
        // time the count came back to 1 (un-check the first person, check
        // anyone; re-check the same person) — the sent notification is the
        // once-per-event stamp.
        //
        // The stamp is a claim in rate_limits, not a count of notifications:
        // a host and a co-host scanning the first two people at once both
        // counted zero sent and pushed every attendee twice, and clearing a
        // bell re-armed it. `<= 2` keeps that race covered when both
        // requests count each other's write.
        if (checkedInCount <= 2 && await claimOnce(`checkin-started:${eventId}`, 3 * 86_400_000)) {
          const [admins, otherAttendees] = await Promise.all([
            prisma.user.findMany({
              where:  { role: 'admin', status: 'approved' },
              select: { id: true },
            }),
            prisma.eventAttendee.findMany({
              where:  { eventId, status: 'approved', userId: { not: userId } },
              select: { userId: true },
            }),
          ])

          for (const admin of admins) {
            createNotification(
              admin.id,
              'checkin_started',
              `${event.emoji} Check-in started`,
              `${event.title} — first attendee just checked in`,
              `/admin/checkin?event=${eventId}`,
            ).catch(() => {})
          }

          for (const attendee of otherAttendees) {
            createNotification(
              attendee.userId,
              'checkin_started',
              `${event.emoji} Doors are open!`,
              `People are arriving at ${event.title} — see you there!`,
              `/events/${eventId}`,
            ).catch(() => {})
          }
        }
      }
    }

    return NextResponse.json(updated)
  } catch (e) {
    console.error('[checkin PATCH]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
