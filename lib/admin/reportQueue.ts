// How the moderation queue is ordered, and when an outstanding report should
// start looking neglected.
//
// Newest-first is right for a log and wrong for a queue: it puts the item that
// has waited longest furthest from the eye. On 2026-09-21 the queue held four
// pending reports and showed them newest-first, so a harassment report — the
// only one of the four with a corroborating block — sat third, under two
// lower-urgency items, 43 days old. The oldest, at 70 days, was last.

export interface QueuedReport {
  status:    string
  reason:    string
  createdAt: string | Date
}

/** Reports auto-created by the post-event survey sweep, not filed by a member. */
export const isAutoReport = (r: QueuedReport) => r.reason === 'post_event_survey'

/**
 * Outstanding work first, then member-filed before survey-generated, then
 * oldest first.
 *
 * The survey split is the app's own distinction rather than a severity
 * judgement invented here: post_event_survey reports are written by the survey
 * sweep, which is why the page already carries a "From surveys" pill to take
 * them out of the view. Beyond that nothing is ranked by reason. A moderator
 * reads the reason and the block count; guessing at severity in code would
 * only bury whatever the guess got wrong.
 */
export function reportOrder(a: QueuedReport, b: QueuedReport): number {
  const open = (r: QueuedReport) => r.status === 'pending' ? 0 : 1
  if (open(a) !== open(b)) return open(a) - open(b)
  const auto = (r: QueuedReport) => isAutoReport(r) ? 1 : 0
  if (auto(a) !== auto(b)) return auto(a) - auto(b)
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

// How long an outstanding report has waited, as a colour. Not a policy and not
// an SLA — nothing enforces these — just the point at which a queue item
// should stop looking the same as one filed this morning.
export const AGING_DAYS    = 7
export const TOO_LONG_DAYS = 30

export const waitedDays    = (iso: string | Date) => (Date.now() - new Date(iso).getTime()) / 86_400_000
export const agingWait     = (iso: string | Date) => waitedDays(iso) >= AGING_DAYS
export const waitedTooLong = (iso: string | Date) => waitedDays(iso) >= TOO_LONG_DAYS
