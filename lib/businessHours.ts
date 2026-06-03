// Shared parsing + "open now" logic for Business.hours.
//
// Shape:
//   { mon: "09:00-22:00" | null, tue: ..., ..., sun: ... }
// Day omitted or null → closed.
//
// Times are interpreted in Europe/Istanbul (UTC+3 year-round; Turkey
// dropped DST in 2016). We compute the current local time by
// formatting `new Date()` into the Istanbul timezone via
// Intl.DateTimeFormat, which is the most robust path that doesn't
// require a tz library.

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayKey = typeof DAY_KEYS[number]

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
  fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

export type BusinessHours = Partial<Record<DayKey, string | null>>

// Strict HH:MM-HH:MM matcher. Accepts 00:00-23:59 in both halves.
// 24:00 is NOT accepted — use "23:59" to express late close (we
// round in renderTime() for display only). Cross-midnight ranges
// (e.g. "21:00-02:00") are explicitly supported.
const RANGE_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/

export function isValidRange(s: unknown): s is string {
  return typeof s === 'string' && RANGE_RE.test(s)
}

/**
 * Validate and normalize a BusinessHours input from the API. Returns
 * a clean object (only known day keys, only valid ranges or null) or
 * an Error describing the first invalid entry. Used in the admin
 * + owner-edit PATCH paths.
 */
export function parseHours(input: unknown):
  | { hours: BusinessHours | null }
  | { error: string }
{
  if (input === null || input === '' || input === undefined) return { hours: null }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Hours must be a JSON object keyed by day' }
  }
  const src = input as Record<string, unknown>
  const out: BusinessHours = {}
  for (const day of DAY_KEYS) {
    if (!(day in src)) continue
    const v = src[day]
    if (v === null || v === '') {
      out[day] = null
      continue
    }
    if (!isValidRange(v)) {
      return { error: `Invalid range for ${day} — expected "HH:MM-HH:MM" (got ${JSON.stringify(v)})` }
    }
    out[day] = v
  }
  // Empty object → treat as null (no hours set).
  return { hours: Object.keys(out).length === 0 ? null : out }
}

// Map ECMAScript getDay() (Sunday = 0) to our day keys.
const JS_DAY_TO_KEY: Record<number, DayKey> = {
  0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
}

/**
 * Current local time + day-of-week in Europe/Istanbul.
 * Returns minutes-since-midnight + DayKey of the local day.
 */
function nowInIstanbul(): { dayKey: DayKey; minutes: number } {
  const now = new Date()
  // formatToParts with the Istanbul timezone gives us hour/minute/weekday
  // without dragging in moment or date-fns.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  }).formatToParts(now)
  let hh = 0, mm = 0, weekdayShort = 'Sun'
  for (const p of parts) {
    if (p.type === 'hour')    hh = parseInt(p.value, 10)
    if (p.type === 'minute')  mm = parseInt(p.value, 10)
    if (p.type === 'weekday') weekdayShort = p.value
  }
  // Map "Mon", "Tue", ... → DayKey
  const SHORT_TO_KEY: Record<string, DayKey> = {
    Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu',
    Fri: 'fri', Sat: 'sat', Sun: 'sun',
  }
  const dayKey = SHORT_TO_KEY[weekdayShort] ?? JS_DAY_TO_KEY[now.getDay()]
  return { dayKey, minutes: hh * 60 + mm }
}

function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(s => parseInt(s, 10))
  return h * 60 + m
}

function prevDay(d: DayKey): DayKey {
  const i = DAY_KEYS.indexOf(d)
  return DAY_KEYS[(i + DAY_KEYS.length - 1) % DAY_KEYS.length]
}

/**
 * Status for the "Open now" badge on the directory card.
 *   - { open: true,  closesAt: "22:00" }
 *   - { open: false, opensAt: "Mon 09:00" } when the next open slot
 *     is on a future day; opensAt omitted if no day in the week has
 *     hours set.
 *   - null when the hours object is invalid/empty (caller hides the
 *     badge entirely).
 *
 * Handles cross-midnight ranges: "21:00-02:00" on Friday is "open"
 * at 01:00 on Saturday via a check against the previous day's range.
 */
export function getOpenStatus(hours: BusinessHours | null | undefined):
  | { open: true;  closesAt: string }
  | { open: false; opensAt?: string }
  | null
{
  if (!hours || typeof hours !== 'object') return null
  // Defensive: if any present day key has a malformed value, treat
  // the whole hours object as untrusted and hide the badge entirely
  // (the API rejects malformed input at write time, so this is
  // belt-and-suspenders for hand-edited rows). Better than rendering
  // "Closed" for an entry with a typo in just one day.
  for (const d of DAY_KEYS) {
    const v = hours[d]
    if (v !== undefined && v !== null && !isValidRange(v)) return null
  }

  const { dayKey, minutes } = nowInIstanbul()

  // 1. Today's range — if cross-midnight ("21:00-02:00"), it's "open"
  //    only before the close minute.
  const today = hours[dayKey]
  if (today && isValidRange(today)) {
    const [openS, closeS] = today.split('-')
    const o = minutesFromHHMM(openS)
    const c = minutesFromHHMM(closeS)
    const isCrossMidnight = c <= o
    if (!isCrossMidnight && minutes >= o && minutes < c) {
      return { open: true, closesAt: closeS }
    }
    if (isCrossMidnight && minutes >= o) {
      // Open from o through 24:00 today.
      return { open: true, closesAt: closeS }
    }
  }

  // 2. Yesterday's cross-midnight range may still be open today.
  const yesterday = hours[prevDay(dayKey)]
  if (yesterday && isValidRange(yesterday)) {
    const [openS, closeS] = yesterday.split('-')
    const o = minutesFromHHMM(openS)
    const c = minutesFromHHMM(closeS)
    if (c <= o && minutes < c) {
      return { open: true, closesAt: closeS }
    }
  }

  // 3. Closed. Find the next opening slot within the next 7 days.
  // Simple modular walk — probe[0] = today, probe[1] = tomorrow, etc.
  const idx = DAY_KEYS.indexOf(dayKey)
  for (let i = 0; i < 7; i++) {
    const probe: DayKey = DAY_KEYS[(idx + i) % DAY_KEYS.length]
    const r = hours[probe]
    if (r && isValidRange(r)) {
      const [openS] = r.split('-')
      const o = minutesFromHHMM(openS)
      if (i === 0 && o > minutes) {
        return { open: false, opensAt: openS } // later today
      }
      if (i > 0) {
        return { open: false, opensAt: `${DAY_LABELS[probe]} ${openS}` }
      }
    }
  }

  return { open: false }
}
