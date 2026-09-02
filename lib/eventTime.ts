// ── When an event starts and ends, as instants ──────────────────────────────
//
// Event.date / time / endTime are wall-clock strings in the event city's
// timezone ('2026-09-12', '19:30', '23:00'). Two routes (the survey sweeper
// and the feedback form) each carried a private copy of "when did this
// end", one of them still hardcoded to +03:00. One home, tz-aware, and the
// place the post-event jobs read from.
//
// Client-safe: no database import (same rule as lib/cityTime). Looking a
// city's timezone up is the caller's job (getCityTz / City.timezone).

import { fromWallClockInTz, DEFAULT_TZ } from '@/lib/cityTime'

const HHMM = /^(\d{1,2}):(\d{2})/

function wallClock(date: string, time: string, tz: string): Date {
  const m = time.match(HHMM)!
  // Pad a single-digit hour — fromWallClockInTz builds an ISO string, and
  // '9:30' would parse as Invalid Date.
  return fromWallClockInTz(`${date}T${m[1].padStart(2, '0')}:${m[2]}`, tz)
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export interface EventClock {
  date:      string
  time?:     string | null
  endTime?:  string | null
}

/** The instant the event starts. A missing/garbled time reads as midnight. */
export function eventStartsAt(event: EventClock, tz: string = DEFAULT_TZ): Date {
  const time = event.time && HHMM.test(event.time) ? event.time : '00:00'
  return wallClock(event.date, time, tz)
}

/**
 * The instant the event ends.
 *
 *   - endTime set → that wall-clock time on the event's date. An end that
 *     reads EARLIER than the start ("22:00 – 02:00") means it runs past
 *     midnight, so it lands on the next day rather than 20 hours before
 *     the doors open.
 *   - endTime missing or unparseable → 23:59 on the date, so nothing
 *     post-event fires while a late-evening event is still going.
 */
export function eventEndsAt(event: EventClock, tz: string = DEFAULT_TZ): Date {
  if (!event.endTime || !HHMM.test(event.endTime)) {
    return wallClock(event.date, '23:59', tz)
  }
  const end = wallClock(event.date, event.endTime, tz)
  if (event.time && HHMM.test(event.time) && end.getTime() < eventStartsAt(event, tz).getTime()) {
    return wallClock(nextDay(event.date), event.endTime, tz)
  }
  return end
}
