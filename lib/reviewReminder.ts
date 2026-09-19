// Dismiss state for the dashboard's "How was <event>?" reminder
// (components/ReviewReminder). Pure so the snooze arithmetic is testable.
//
// Two different answers used to share one button. "Maybe later" dismissed
// the event for good, so a member who meant "not now" was never asked about
// it again. Now:
//   - "Maybe later" snoozes the whole reminder for a week (one timestamp), so
//     it doesn't just hand them the next event's card instead.
//   - ✕ ("Don't ask again") drops that one event permanently, by id.

export const DISMISSED_KEY = 'dismissed_reviews'
export const SNOOZE_KEY    = 'review_reminder_snoozed_until'
export const SNOOZE_MS     = 7 * 24 * 60 * 60_000

/** Stored ids, or [] for anything that isn't a string array. */
export function parseDismissedIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** True while a "Maybe later" is still in force. Junk reads as not snoozed. */
export function isSnoozed(raw: string | null, now: number): boolean {
  if (!raw) return false
  const until = Number(raw)
  return Number.isFinite(until) && until > now
}

export function snoozeUntil(now: number): string {
  return String(now + SNOOZE_MS)
}
