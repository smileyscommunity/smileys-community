import { eventEndsAt } from '@/lib/eventTime'
import { checkInIsCredible, NO_SHOW_PROCESSING_LOOKBACK_DAYS } from '@/lib/noShowPolicy'
import { DEFAULT_TZ } from '@/lib/cityTime'

// ── "You haven't checked anyone in" ─────────────────────────────────────────
//
// The host-facing counterpart to NoShowBanner. The no-show sweeper reads an
// unchecked seat as a no-show only on events where the host actually ran
// check-in (checkInIsCredible); with nobody scanned it skips the event
// entirely rather than hand cards to the whole room. That guard is right,
// but it also means the cards, the appeals and the waiver never fire for a
// host who forgets — the feature quietly does nothing.
//
// So: after an event ends, if the room went unchecked, say so where the host
// will see it, and link straight to the scanner. There is a real deadline —
// the sweeper stops looking NO_SHOW_PROCESSING_LOOKBACK_DAYS after the end,
// and once an event falls out of that window its attendance can never be
// settled — so the prompt counts down instead of nagging forever.
//
// Factual, not scolding: a host who checked nobody in may simply have run a
// small event where it wasn't worth it, and skipping is a legitimate choice.

const DAY = 24 * 60 * 60 * 1000

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
  daysLeft: number
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
    if (approved < 1 || checkInIsCredible(checked, approved)) return []
    const endsAt = eventEndsAt(e, tz).getTime()
    if (endsAt > now.getTime()) return []                       // still running
    // Same floor the sweeper uses: an event that ended longer ago than the
    // lookback is never processed again, so there is nothing left to save.
    const deadline = endsAt + NO_SHOW_PROCESSING_LOOKBACK_DAYS * DAY
    if (deadline <= now.getTime()) return []
    return [{
      event: e, approved, checked,
      daysLeft: Math.max(1, Math.ceil((deadline - now.getTime()) / DAY)),
    }]
  }).sort((a, b) => a.daysLeft - b.daysLeft)
}

/**
 * The events a member runs the door for: host, co-host, or an approved host
 * of the event's active club — exactly who canManageEventOps lets through the
 * check-in API. Feeds /host/checkin and the dashboard prompt
 * (/api/host/events?scope=door). Bounded to the days check-in still matters —
 * the prompt's lookback behind, tomorrow ahead for a city in a zone ahead —
 * so the host of a long-running club doesn't pull every event it ever ran.
 */
export function doorEventsWhere(userId: string, now: Date = new Date()) {
  const day = (offset: number) => new Date(now.getTime() + offset * DAY).toISOString().slice(0, 10)
  return {
    date: { gte: day(-(NO_SHOW_PROCESSING_LOOKBACK_DAYS + 1)), lte: day(1) },
    OR: [
      { hostId: userId },
      { cohosts: { some: { userId } } },
      { club: { is: { isActive: true, memberships: { some: { userId, role: 'host', status: 'approved' } } } } },
    ],
  }
}
