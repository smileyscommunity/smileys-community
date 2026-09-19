import { eventEndsAt } from '@/lib/eventTime'
import { attendanceSettlesAt, HOST_MARKING_WINDOW_DAYS } from '@/lib/standingPolicy'
import { DEFAULT_TZ } from '@/lib/cityTime'

// ── "You haven't checked anyone in" ─────────────────────────────────────────
//
// The host-facing counterpart to NoShowBanner. The standing sweep reads an
// unchecked seat as a no-show only on events where the host actually ran
// check-in; with nobody scanned it skips the event
// entirely rather than hand cards to the whole room. That guard is right,
// but it also means the cards, the appeals and the waiver never fire for a
// host who forgets — the feature quietly does nothing.
//
// So: after an event ends, if the room went unchecked, say so where the host
// will see it, and link straight to the scanner. There is a real deadline —
// at the end of the day after the event (attendanceSettlesAt) the standing
// sweep settles the room — so the prompt counts down instead of nagging.
//
// Factual, not scolding: a host who checked nobody in may simply have run a
// small event where it wasn't worth it, and skipping is a legitimate choice.

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR

export interface CheckInPromptEvent {
  id:                 string
  title:              string
  emoji:              string
  date:               string
  time:               string
  endTime?:           string | null
  status:             string
  price:              number
  memberPrice?:       number | null
  payTo?:             string | null
  ticketUrl?:         string | null
  paymentContact?:    string | null
  noShowProcessedAt?: string | null
  checkedInCount?:    number
  _count?:            { attendees: number }
  // The room without host and co-hosts — what the sweeper counts
  // (/api/host/events). Preferred over the raw counts above when present.
  roomApproved?:      number
  roomCheckedIn?:     number
}

export interface PendingCheckIn {
  event:    CheckInPromptEvent
  approved: number
  checked:  number
  hoursLeft: number
}

/**
 * Events that have ended without a credible check-in, while there is still
 * time to fix it. Exported so the check-in page can offer the same list —
 * a prompt that dead-ends on "No events today" is worse than no prompt.
 */
export function awaitingCheckIn(
  events: CheckInPromptEvent[], tz: string = DEFAULT_TZ, now: Date = new Date(),
): PendingCheckIn[] {
  return events.flatMap(e => {
    // 'archived' too: the reminders cron retires every event the morning
    // after it ran, which is exactly when a host looks at the dashboard.
    // The sweeper settles both statuses; this list must match it.
    if ((e.status !== 'published' && e.status !== 'archived') || e.noShowProcessedAt) return []
    // Every event, paid and prepaid included. This used to chase only events
    // under the no-show policy, which left prepaid ones (Sunset Sailing, paid
    // to Smileys) without a single prompt — and without a check-in on most of
    // their runs. Attendance is the record of who came, whatever the price.
    const approved = e.roomApproved  ?? e._count?.attendees ?? 0
    const checked  = e.roomCheckedIn ?? e.checkedInCount    ?? 0
    // Anyone unaccounted for is worth a prompt. This used to stop at
    // CHECK_IN_RAN_RATIO — 70% scanned and the host heard no more — which
    // made sense when the ratio decided whether absences counted. It no
    // longer decides anything, and the three people still unscanned are
    // exactly the ones heading for a warning, so the prompt follows them
    // rather than a percentage. It clears at the settle either way.
    if (approved < 1 || checked >= approved) return []
    const endsAt = eventEndsAt(e, tz).getTime()
    if (endsAt > now.getTime()) return []                       // still running
    // Past the resolution the room is settled: nothing left to check in.
    const deadline = attendanceSettlesAt(e, tz).getTime()
    if (deadline <= now.getTime()) return []
    return [{
      event: e, approved, checked,
      hoursLeft: Math.max(1, Math.ceil((deadline - now.getTime()) / HOUR)),
    }]
  }).sort((a, b) => a.hoursLeft - b.hoursLeft)
}

/**
 * The events a member runs the door for: host, co-host, or an approved host
 * of the event's active club — exactly who canManageEventOps lets through the
 * check-in API. Feeds /host/checkin and the dashboard prompt
 * (/api/host/events?scope=door). Bounded to the days check-in still matters —
 * two days behind (an event still inside its resolution window), tomorrow
 * ahead for a city in a zone ahead —
 * so the host of a long-running club doesn't pull every event it ever ran.
 */
export function doorEventsWhere(userId: string, now: Date = new Date()) {
  const day = (offset: number) => new Date(now.getTime() + offset * DAY).toISOString().slice(0, 10)
  return {
    // Back as far as a host may still act. Attendance can be marked or waived
    // for HOST_MARKING_WINDOW_DAYS after a room settles, but this list reached
    // two days — so the month-long window we give hosts was only usable for a
    // couple of days, or through the review queue's deep link. The page that
    // performs the action now lists the events it applies to.
    date: { gte: day(-(HOST_MARKING_WINDOW_DAYS + 2)), lte: day(1) },
    OR: [
      { hostId: userId },
      { cohosts: { some: { userId } } },
      { club: { is: { isActive: true, memberships: { some: { userId, role: 'host', status: 'approved' } } } } },
    ],
  }
}

/**
 * Events a host can still act on, newest first: the room has settled, so it is
 * off the "awaiting check-in" prompt, but marking and waiving stay open for
 * HOST_MARKING_WINDOW_DAYS. Without these the check-in page offers only the
 * last two days and a host correcting a week-old absence has nowhere to land.
 *
 * Deliberately separate from awaitingCheckIn: these are not work the host owes
 * anyone tonight, they are events that remain correctable.
 */
export function stillCorrectable<E extends CheckInPromptEvent>(
  events: E[], tz: string = DEFAULT_TZ, now: Date = new Date(),
): E[] {
  return events
    .filter(e => {
      if (e.status !== 'published' && e.status !== 'archived') return false
      const zone     = (e as { timezone?: string | null }).timezone || tz
      const settles  = attendanceSettlesAt(e, zone).getTime()
      const closes   = settles + HOST_MARKING_WINDOW_DAYS * DAY
      const t        = now.getTime()
      // Settled (so not on the prompt) but inside the window.
      return t >= settles && t < closes
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}
