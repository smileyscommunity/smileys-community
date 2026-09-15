import { noShowExemptionReason, NO_SHOW_PROCESSING_LOOKBACK_DAYS, type EventRunners } from '@/lib/noShowPolicy'
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

const DAY = 24 * 60 * 60 * 1000

export type CloseOutBlock = 'not_started' | 'too_late'

export const CLOSE_OUT_BLOCK_MESSAGE: Record<CloseOutBlock, string> = {
  not_started: "The event hasn't started yet — no-shows can be marked once it has.",
  too_late:    `This event ended more than ${NO_SHOW_PROCESSING_LOOKBACK_DAYS} days ago — its attendance can't be changed any more.`,
}

/**
 * Why no-shows can't be marked right now, or null when they can. Not before
 * the start — nobody is late yet — and not after the check-in prompt's
 * lookback, the same window a host is chased about an unchecked room.
 */
export function closeOutBlock(startsAt: Date, endsAt: Date, now: Date): CloseOutBlock | null {
  if (now.getTime() < startsAt.getTime()) return 'not_started'
  if (now.getTime() > endsAt.getTime() + NO_SHOW_PROCESSING_LOOKBACK_DAYS * DAY) return 'too_late'
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
  user:       { role: string } | null
}

/** The rows a close-out marks: approved, unscanned, unmarked, not exempt. */
export function noShowCandidates<R extends CloseOutRow>(rows: R[], runners: EventRunners): R[] {
  return rows.filter(r =>
    r.status === AttendeeStatus.Approved
    && !r.checkedIn
    && r.attendance === Attendance.Unknown
    && !isExemptFromNoShow(r.userId, r.user?.role, runners))
}
