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

// ── Normalising what people type into a time box ────────────────────────────
//
// The host forms take time/endTime as free text and the routes stored it
// verbatim, so production collected '22.00', '18' and '24:00' (16 events,
// 2026-09 audit). None of them matched the reader's H:MM pattern, so every
// one silently ended at 23:59. One normaliser, used by every create/update
// path, the duplicate path, the repair script and the reader below.
//
//   'H:MM' / 'HH:MM' / 'H.MM' / 'HH.MM' / 'HHMM' → 'HH:MM'
//   'H' / 'HH' (bare hour)                        → 'HH:00'
//   '24:00' (and '24', '24.00', '2400')           → '23:59' for an END time —
//       eventEndsAt already reads "no end" as 23:59, so that IS this codebase's
//       end of day. As a START it is rejected: there is no 24 o'clock to begin at.
//   anything else                                 → null (caller decides: 400,
//       UNFIXABLE, or the reader's fallback)
export const STRICT_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export type ClockKind = 'start' | 'end'

export function normalizeClock(raw: unknown, kind: ClockKind = 'start'): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  // Hosts also type '23 30' and '21h45' (the French/Turkish habit) — six live
  // rows in the Sept 2026 audit were only unreadable for that separator.
  const m = s.match(/^(\d{1,2})\s*[:.hH ]\s*(\d{2})$/) ?? s.match(/^(\d{2})(\d{2})$/) ?? s.match(/^(\d{1,2})()$/)
  if (!m) return null
  const h   = Number(m[1])
  const min = m[2] === '' ? 0 : Number(m[2])
  if (h === 24 && min === 0) return kind === 'end' ? '23:59' : null
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * Validates a time field from a create/update body. `value` is what to store;
 * `error` is a 400 message. 'TBA' is a real start time in this data (see
 * lib/eventJsonLd) and stays accepted; a blank end time clears it.
 */
export function eventTimeInput(raw: unknown, kind: ClockKind): { value: string | null } | { error: string } {
  const label = kind === 'start' ? 'Start time' : 'End time'
  const s = typeof raw === 'string' ? raw.trim() : raw
  // ':00' is what the admin form's hour/minute selects send with no hour picked.
  const blank = s === undefined || s === null || s === '' || (typeof s === 'string' && /^:\d{0,2}$/.test(s))
  if (blank) return kind === 'end' ? { value: null } : { error: `${label} is required` }
  if (kind === 'start' && typeof s === 'string' && s.toUpperCase() === 'TBA') return { value: 'TBA' }
  const value = normalizeClock(s, kind)
  if (!value) {
    return { error: `${label} ${JSON.stringify(typeof s === 'string' ? s : String(s))} isn't a time — use HH:MM, e.g. ${kind === 'start' ? '19:30' : '22:00'}` }
  }
  return { value }
}

// The reader is more forgiving than the write path: rows written before the
// validator existed must still read right until scripts/repair-malformed-
// event-times.ts has run. The normaliser first ('22.00' → 22:00, '24:00' as an
// end → 23:59), then the old prefix match ('19:30:00', '19:00 – 22:00'), which
// is what already read correctly before and must not regress.
const LEGACY_PREFIX = /^(\d{1,2}):(\d{2})/

function readClock(raw: string | null | undefined, kind: ClockKind): string | null {
  if (!raw) return null
  const normal = normalizeClock(raw, kind)
  if (normal) return normal
  const m = raw.trim().match(LEGACY_PREFIX)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function wallClock(date: string, time: string, tz: string): Date {
  // `time` is always readClock output here: already zero-padded 'HH:MM'.
  return fromWallClockInTz(`${date}T${time}`, tz)
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
  return wallClock(event.date, readClock(event.time, 'start') ?? '00:00', tz)
}

/**
 * The instant the event ends.
 *
 *   - endTime set → that wall-clock time on the event's date. An end that
 *     reads EARLIER than the start ("22:00 – 02:00") means it runs past
 *     midnight, so it lands on the next day rather than 20 hours before
 *     the doors open.
 *   - start unknown ("TBA") but endTime set → there is no start to compare
 *     against, so the end's own hour decides: before 06:00 it is read as
 *     past midnight (next day), otherwise as that time on the date. A
 *     "TBA – 02:00" night out used to end at 02:00 on its own date, before
 *     the day had begun, and the post-event jobs fired a whole day early.
 *     Erring later is the safe direction for everything that reads this.
 *   - endTime missing or unparseable → 23:59 on the date, so nothing
 *     post-event fires while a late-evening event is still going.
 */
const EARLY_MORNING_END_HOUR = 6

export function eventEndsAt(event: EventClock, tz: string = DEFAULT_TZ): Date {
  // Legacy '22.00' / '18' read as the times they are (readClock), not as 23:59.
  const endTime = readClock(event.endTime, 'end')
  if (!endTime) {
    return wallClock(event.date, '23:59', tz)
  }
  const end = wallClock(event.date, endTime, tz)
  const startKnown = readClock(event.time, 'start') !== null
  const pastMidnight = startKnown
    ? end.getTime() < eventStartsAt(event, tz).getTime()
    : Number(endTime.slice(0, 2)) < EARLY_MORNING_END_HOUR
  if (pastMidnight) {
    return wallClock(nextDay(event.date), endTime, tz)
  }
  return end
}

// ── Where an event is in its day, for the status banner ──────────────────────
//
// 'soon' from two hours before the start, 'live' from the start until the end
// (endTime, or 23:59 when there is none — the same end the post-event jobs
// use). The event page used to show "Live Now" for the whole window, which
// put a green LIVE badge on a 19:00 event at 17:35 (2026-09-09). The
// two-hour lead is still useful — hosts check people in early and the page
// should say the doors are about to open — it just isn't "live".
export type EventPhase = 'soon' | 'live' | null

export const EVENT_SOON_LEAD_MS = 2 * 60 * 60_000

export function eventPhase(event: EventClock, tz: string = DEFAULT_TZ, now: Date = new Date()): EventPhase {
  // "TBA" (or any time that doesn't parse) has no start to be near. Read as
  // midnight, it was "Live Now" all day and "Starting soon" from 22:00 the
  // evening before.
  if (readClock(event.time, 'start') === null) return null
  const start = eventStartsAt(event, tz).getTime()
  const end   = eventEndsAt(event, tz).getTime()
  const t     = now.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (t >= start && t < end) return 'live'
  if (t >= start - EVENT_SOON_LEAD_MS && t < start) return 'soon'
  return null
}
