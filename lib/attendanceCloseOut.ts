import { noShowExemptionReason, type EventRunners } from '@/lib/noShowPolicy'
import { Attendance, AttendeeStatus } from '@/lib/constants'

// ── Closing out the door: "mark the rest as no-show" ───────────────────────
//
// v1 read every unscanned seat as a no-show once half the room was scanned.
// All 95 cards it issued were reversed — missed scans, and cancels made on
// WhatsApp that never reached the app. So a no-show is now something the
// host SAYS, at the end, looking at the roster: every approved guest who is
// neither checked in nor already marked, minus the people running the event
// and staff (the same exemption the v1 sweep used).
//
// Client-safe on purpose: the check-in page counts the same "rest" the
// route (app/api/events/[id]/checkin/close-out) marks.

export type CloseOutBlock = 'not_started' | 'too_late'

export const CLOSE_OUT_BLOCK_MESSAGE: Record<CloseOutBlock, string> = {
  not_started: "The event hasn't started yet — no-shows can be marked once it has.",
  too_late:    'This event is too old to mark now — attendance closed a month after it ran.',
}

/**
 * Why attendance can't be marked right now (no-show, excused), or null when it
 * can. Not before the start — nobody is late yet — and not past
 * attendanceMarkingClosesAt.
 *
 * The deadline used to be midnight of the review day, which locked the host
 * out roughly a day after the event while the guest kept a month to contest.
 * The only person who was at the door had the shortest say in what happened
 * there. Both windows are the same length now.
 */
export function closeOutBlock(startsAt: Date, marksCloseAt: Date, now: Date): CloseOutBlock | null {
  if (now.getTime() < startsAt.getTime()) return 'not_started'
  if (now.getTime() >= marksCloseAt.getTime()) return 'too_late'
  return null
}

/** Runs the event or is staff: never a no-show. The roster flag and the close-out share it. */
export function isExemptFromNoShow(userId: string, role: string | null | undefined, runners: EventRunners): boolean {
  return noShowExemptionReason(userId, role, runners) !== null
}

export interface CloseOutRow {
  id:         string
  userId:     string
  status:     string
  checkedIn:  boolean
  attendance: string
  /** Set when the sweep defaulted this row rather than a person deciding it. */
  attendanceAutoResolvedAt?: Date | string | null
  user:       { role: string } | null
}

/**
 * A seat the sweep defaulted to attended because nobody said otherwise. It
 * reads as attended everywhere, and it is still the host's to correct: the
 * stamp is the difference between "someone decided this" and "the clock ran
 * out". A row a person checked in, excused or marked is never in here.
 */
export function wasDefaulted(r: CloseOutRow): boolean {
  return !r.checkedIn && r.attendance === Attendance.Attended && !!r.attendanceAutoResolvedAt
}

/**
 * The rows a close-out marks: approved, unscanned, not exempt, and either
 * never marked or only defaulted by the sweep. Nothing auto-settles to a
 * no-show any more, so a host closing out late is correcting a default, not
 * overriding a decision.
 */
export function noShowCandidates<R extends CloseOutRow>(rows: R[], runners: EventRunners): R[] {
  return rows.filter(r =>
    r.status === AttendeeStatus.Approved
    && !r.checkedIn
    && (r.attendance === Attendance.Unknown || wasDefaulted(r))
    && !isExemptFromNoShow(r.userId, r.user?.role, runners))
}

/**
 * The page's count of what a close-out would mark, from the roster the check-in
 * GET returns (`exempt` is decided on the server, where the roles are).
 */
export function restToClose<R extends { checkedIn: boolean; attendance?: string; exempt?: boolean; status?: string; listed?: boolean }>(rows: R[]): R[] {
  // An RSVP the sweep already resolved, or one the host excused, isn't "the rest" either.
  // Nor is anyone without a seat: since the door roster started carrying
  // waitlisted and pending rows (so a scan can name them rather than call
  // them strangers), "mark the rest as no-show" was counting people who were
  // never let in — the button offered to mark twelve and the server, which
  // only ever touches approved seats, marked none.
  const seated = (r: R) => r.listed ?? (r.status === undefined || r.status === AttendeeStatus.Approved)
  return rows.filter(r => seated(r) && !r.checkedIn && (r.attendance ?? Attendance.Unknown) === Attendance.Unknown && !r.exempt)
}

/**
 * Can the host excuse this row in the review (POST ../checkin/excuse)? An
 * approved guest who wasn't scanned: still unmarked, or marked a no-show the
 * host now knows had a reason. Excusing is never offered for someone running
 * the event — they can't be a no-show to begin with.
 */
export function canExcuse(row: CloseOutRow, runners: EventRunners): boolean {
  return row.status === AttendeeStatus.Approved
    && !row.checkedIn
    && (row.attendance === Attendance.Unknown || row.attendance === Attendance.NoShow)
    && !isExemptFromNoShow(row.userId, row.user?.role, runners)
}
