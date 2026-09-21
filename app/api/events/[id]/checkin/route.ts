import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageEventOps } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { rateLimit, claimOnce } from '@/lib/rateLimit'
import { verifyCardToken } from '@/lib/cardToken'
import { CHECKIN_QUEUE_MAX_AGE_MS } from '@/lib/checkinQueue'
import { Attendance } from '@/lib/constants'
import { eventStartsAt, eventEndsAt } from '@/lib/eventTime'
import { attendanceSettlesAt, lateReplayAllowed } from '@/lib/standingPolicy'
import { writeAudit } from '@/lib/audit'
import { getCityTz } from '@/lib/city'
import { eventRunners } from '@/lib/noShowPolicy'
import { isExemptFromNoShow } from '@/lib/attendanceCloseOut'
import { doorKey } from '@/lib/standingPolicy'
import { saysCameKey } from '@/lib/standing'

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

    // Approved seats, plus the people a scan would otherwise report as
    // strangers: someone on the waitlist IS registered, and "not registered
    // for this event" was the only thing the door could say about them.
    const attendees = await prisma.eventAttendee.findMany({
      where: { eventId, status: { in: ['approved', 'waitlisted', 'pending'] } },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true, role: true } } },
      orderBy: { joinedAt: 'asc' },
    })

    // No email reaches the door. This used to send one to admins and to the
    // primary host, on the reasoning that they are trusted — but trust was
    // never the issue. The door roster is a screen held up in public, handed
    // between people at the entrance and left open on a table, and an email
    // address does not help anyone check a guest in: the name and photo do
    // that. An admin who needs to contact someone has the participants page,
    // which is not a screen you hold in a doorway.
    const event = await prisma.event.findUnique({
      where:  { id: eventId },
      select: {
        hostId:  true,
        cohosts: { select: { userId: true } },
        club:    { select: { memberships: { where: { role: 'host', status: 'approved' }, select: { userId: true } } } },
      },
    })
    // Guests who said "I was there" during the morning-after review.
    const claimPrefix = saysCameKey(eventId, '')
    const saysCame = new Set((await prisma.rateLimit.findMany({
      where: { key: { startsWith: claimPrefix }, resetAt: { gt: new Date() } }, select: { key: true },
    })).map(r => r.key.slice(claimPrefix.length)))

    // `exempt`: runs the event or is staff, so never a no-show — the roster
    // leaves them out of "mark the rest" (lib/attendanceCloseOut). The role
    // it is read from stays on the server.
    const runners = eventRunners(event)
    const mapped = attendees.map(a => {
      // Two locks, because one of them is easy to pick open by accident: the
      // select above does not ask for an email, and this drops one anyway if
      // a later edit adds it back for some other purpose.
      const { role, email: _email, ...publicUser } = a.user as typeof a.user & { email?: string }
      return {
        ...a,
        exempt: isExemptFromNoShow(a.userId, role, runners),
        // The door lists only approved seats; the rest ride along so a scan
        // can name what it found.
        listed: a.status === 'approved',
        saysCame: saysCame.has(a.userId),
        user:   publicUser,
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

    const { userId, checkedIn, scannedAt, cardToken } = await req.json()
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId must be a non-empty string' }, { status: 400 })
    }
    if (typeof checkedIn !== 'boolean') {
      return NextResponse.json({ error: 'checkedIn must be a boolean' }, { status: 400 })
    }

    // A scan has to prove itself. The card's QR is signed and expires
    // (lib/cardToken) because the old one was the member's bare id: anyone
    // could draw another member's code, and a screenshot of a real card
    // worked for ever, at any event — which since standing v2 is a way to
    // clear your own no-show card without leaving the house. A host's own
    // tap on the list carries no token and is unaffected: they are already
    // authorised for this event, and they can see who is in front of them.
    if (cardToken !== undefined && cardToken !== null) {
      // Judged at the moment of the tap, not of the request: a scan taken at
      // the door on a phone with no signal is replayed hours later
      // (lib/checkinQueue), and against "now" a card that was valid in the
      // room would be refused when the queue finally drains. A tap time is
      // only trusted backwards — a future one falls back to now, and the
      // settle rules below still bound how late a replay may land.
      // Bounded by how long the queue keeps a tap at all: without a floor,
      // a request could claim a scan from weeks back and present a card from
      // that week — and the audit row's `viaScan` would say a scan happened.
      const oldestReplay = Date.now() - CHECKIN_QUEUE_MAX_AGE_MS
      const tapped = typeof scannedAt === 'number' && Number.isFinite(scannedAt)
        && scannedAt <= Date.now() && scannedAt >= oldestReplay
        ? new Date(scannedAt)
        : new Date()
      const card = verifyCardToken(cardToken, tapped)
      if (!card.ok) {
        // The codes this replaced — a bare member id, or the old
        // event-specific one — still sit in cached pages and screenshots.
        // Told apart from a forgery so the door says something useful.
        const outdated = typeof cardToken === 'string'
          && (cardToken.startsWith('smileys:member:') || cardToken.startsWith('smileys-checkin:'))
        return NextResponse.json(
          outdated
            ? { error: 'That card is out of date — ask them to open the app again.', code: 'card_outdated' }
            : card.reason === 'expired'
            ? { error: 'That card has expired — ask them to open the app again to refresh it.', code: 'card_expired' }
            : { error: "That code isn't a valid member card.", code: 'card_invalid' },
          { status: 400 })
      }
      if (card.userId !== userId) {
        return NextResponse.json({ error: "That code belongs to a different member.", code: 'card_invalid' }, { status: 400 })
      }
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

    // Standing settles the room when the host's review day ends (lib/standing:
    // midnight, the day after the event). Past that line attendance is settled
    // both ways, and a correction is a dispute a moderator decides — not a
    // scan, days later, by whoever runs the door.
    // Except a check-in tapped before that line on a phone with no signal and
    // sent after it (lib/checkinQueue carries the tap time): the scan was
    // real, the network wasn't. Audited, and the next sweep overturns any
    // no-show the settle wrote for that seat (overturnCorrected).
    const tz = await getCityTz(event.cityId)
    const settlesAt  = attendanceSettlesAt(event, tz)
    const doorOpensAt  = eventStartsAt(event, tz).getTime() - CHECKIN_OPENS_HOURS_BEFORE * 60 * 60_000
    const doorClosesAt = settlesAt.getTime()
    const lateReplay = checkedIn === true
      && lateReplayAllowed(scannedAt, settlesAt, new Date(), { opensAt: doorOpensAt, closesAt: doorClosesAt })
    if (Date.now() >= settlesAt.getTime() && !lateReplay) {
      return NextResponse.json({
        error: "Attendance for this event is settled — check-in closed at the end of the day after it.",
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

    // Who ran the door: an admin or moderator checking people in isn't on the
    // event, and gets the morning-after list with its hosts (lib/standing
    // sendAttendanceReviews). A claim, so a busy door writes one row.
    if (checkedIn) await claimOnce(doorKey(eventId, session.id), 30 * 86_400_000).catch(() => {})
    // Who marked whom, and when. Every other attendance write is audited —
    // excuse, close-out, waive, removal — and this one, the one that clears
    // a standing card and counts towards a host's own numbers, was not. A
    // room checked in by a host for friends who never came left no trace at
    // all beyond a single "ran the door" row.
    await writeAudit(session.id, session.name, checkedIn ? 'checkin.set' : 'checkin.cleared', eventId, 'event',
      { userId, checkedIn, viaScan: cardToken !== undefined && cardToken !== null, cityId: event.cityId },
      `${checkedIn ? 'Checked in' : 'Un-checked'} a member at the door`)
    if (lateReplay) {
      await writeAudit(session.id, session.name, 'checkin_late_replay', eventId, 'event',
        { userId, scannedAt: new Date(scannedAt).toISOString(), settledAt: settlesAt.toISOString() },
        `Check-in tapped ${new Date(scannedAt).toISOString()} arrived after the room settled`)
    }

    // A check-in made in the morning-after review is a correction, not an
    // arrival: no "welcome", no live count, no "doors are open".
    // The block below re-reads the event for its title and host, shadowing
    // this one — keep the clock fields before it.
    const eventClock = event
    if (checkedIn && Date.now() < eventEndsAt(event, tz).getTime()) {
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
        // …and not before the evening itself. The door opens twelve hours
        // ahead, so a host testing the scanner at noon told the whole room
        // "people are arriving" eight hours early — and because the stamp is
        // spent, nobody heard anything when the doors really opened.
        //
        // The count is only the race guard (two hosts scanning the first two
        // people at once): it must not gate the announcement as well, or a
        // host who scans five early arrivals before the window opens means
        // nobody is ever told. The claim is what makes this once per event.
        const nearStart = Date.now() >= eventStartsAt(eventClock, tz).getTime() - 60 * 60_000
        if (nearStart && await claimOnce(`checkin-started:${eventId}`, 3 * 86_400_000)) {
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
