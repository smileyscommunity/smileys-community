import { createNotification } from '@/lib/notify'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { loadPostponedEvents, planPostponed, POSTPONED_REREMIND_DAYS } from '@/lib/postponedEvents'

// Host reminders for postponed events with no new date (see lib/postponedEvents
// for who is due one). Run daily from the sweep-waitlists cron.

const DAY_MS = 86_400_000

export const postponedReminderKey = (eventId: string) => `postponed-host-reminder:${eventId}`

/**
 * One bell entry for the host of each postponed event due a reminder. The
 * claim (rate_limits, which no one can clear from their bell) makes it once
 * per 14 days per event; a write that failed hands the claim back so the next
 * daily run retries.
 */
export async function remindHostsOfPostponedEvents(now: Date = new Date()): Promise<{ checked: number; reminded: number }> {
  const rows = planPostponed(await loadPostponedEvents(), now)
  let reminded = 0
  for (const r of rows) {
    if (!r.remindHost) continue
    const key = postponedReminderKey(r.id)
    if (!await claimOnce(key, POSTPONED_REREMIND_DAYS * DAY_MS)) continue
    const waiting = [
      r.seats   && `${r.seats} member${r.seats !== 1 ? 's' : ''} still holding a spot`,
      r.pending && `${r.pending} request${r.pending !== 1 ? 's' : ''} waiting`,
      r.waitlist && `${r.waitlist} on the waitlist`,
    ].filter(Boolean).join(', ')
    // An existing, un-muteable type the bell already files under Admin: a new
    // type would sit in no filter tab (lib/notificationFilters).
    const sent = await createNotification(
      r.hostId,
      'system_alert',
      'Your postponed event needs a date ⏸️',
      `"${r.title}" has been postponed for ${r.daysSincePostponed} days with ${waiting}. Set a new date, or cancel it so they can make other plans.`,
      `/host/events/${r.id}/edit`,
    )
    if (sent) reminded++
    else await releaseClaim(key)
  }
  return { checked: rows.length, reminded }
}
