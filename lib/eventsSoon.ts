import { shiftDay } from '@/lib/cityTime'
import { eventEndsAt } from '@/lib/eventTime'

// The dashboard's "Today & tomorrow" strip: what the member can still join in
// the next two city days. Built from the events the page already reads for
// "This week", so it costs no query. Their own events and ones already asked
// for are left out — the strip is for deciding what to go to, and "Going ✓"
// belongs to the full week list below.

export const EVENTS_SOON_MAX   = 3
// Show a seat count only when it is a reason to hurry, not on every event.
export const SEATS_HURRY_AT    = 8

export interface SoonEvent {
  id:           string
  title:        string
  emoji:        string
  date:         string
  time:         string | null
  endTime:      string | null
  neighborhood: string | null
  soldOut:      boolean
  limitedSpots: boolean
  spotsLeft:    number
}

export interface SoonItem {
  id: string; title: string; emoji: string; neighborhood: string | null
  day: 'Today' | 'Tomorrow'; time: string | null; seatsLeft: number | null
}

export function eventsSoon(
  events: SoonEvent[],
  opts: { today: string; tz: string; now: number; joined: Set<string>; pending: Set<string> },
): SoonItem[] {
  const tomorrow = shiftDay(opts.today, 1)
  return events
    .filter(e =>
      (e.date === opts.today || e.date === tomorrow) &&
      eventEndsAt(e, opts.tz).getTime() > opts.now &&
      !e.soldOut && !(e.limitedSpots && e.spotsLeft <= 0) &&
      !opts.joined.has(e.id) && !opts.pending.has(e.id))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
    .slice(0, EVENTS_SOON_MAX)
    .map(e => ({
      id: e.id, title: e.title, emoji: e.emoji, neighborhood: e.neighborhood,
      day: e.date === opts.today ? 'Today' as const : 'Tomorrow' as const,
      time: e.time,
      seatsLeft: e.limitedSpots && e.spotsLeft > 0 && e.spotsLeft <= SEATS_HURRY_AT ? e.spotsLeft : null,
    }))
}
