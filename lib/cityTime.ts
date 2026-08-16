// ── Per-city "what day/time is it" (pure, client-safe) ──────────────────────
//
// Event.date and friends are bare 'YYYY-MM-DD' strings meaning a calendar day
// in the city the content belongs to — not UTC, and never the viewer's clock.
// Every "is this today / upcoming / past" comparison has to resolve that day in
// the right timezone, or a member abroad sees a different Tuesday than the
// community means.
//
// Deliberately free of any database import: lib/data.ts re-exports through here
// and is imported by CLIENT components (BottomNav, EventCard). Pulling prisma
// in would drag the Postgres driver into the browser bundle and the build fails
// resolving `fs`/`tls`. Looking a city's timezone UP is a server concern
// (getCityTz in lib/city.ts); turning a timezone into a date lives here.
//
// Everything below reads Intl.DateTimeFormat parts rather than doing offset
// arithmetic. A hand-built "+03:00" is what welded the old code to Istanbul and
// would silently break the first time a city observes DST.

// Istanbul: the founding city, and the timezone every Istanbul-implicit surface
// still assumes. New code that knows its city should pass that city's tz.
export const DEFAULT_TZ = 'Europe/Istanbul'

// cities.timezone is admin-edited text, and an invalid value ('EUROPE'
// happened once) reaches here as-is — Intl then throws, which 500s every
// feed of that city until someone fixes the row. Degrade to the default
// zone instead. Memoized: this sits on every city-scoped request.
const tzFallbacks = new Map<string, string>()
function safeTz(tz: string): string {
  let resolved = tzFallbacks.get(tz)
  if (resolved === undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); resolved = tz }
    catch { resolved = DEFAULT_TZ }
    tzFallbacks.set(tz, resolved)
  }
  return resolved
}

/** The calendar date of `d` in `tz`, as 'YYYY-MM-DD'. */
export function dayInTz(d: Date, tz: string = DEFAULT_TZ): string {
  // 'en-CA' formats as ISO (2026-08-15). A formatting trick, not a locale
  // preference — don't "tidy" it to en-US.
  return d.toLocaleDateString('en-CA', { timeZone: safeTz(tz) })
}

/**
 * Today's date in `tz`, optionally shifted by whole days.
 * Callers get "a week out" without doing UTC arithmetic themselves.
 */
export function todayInTz(tz: string = DEFAULT_TZ, offsetDays = 0): string {
  const d = new Date()
  if (offsetDays) d.setDate(d.getDate() + offsetDays)
  return dayInTz(d, tz)
}

export interface TzNow {
  date:         string   // 'YYYY-MM-DD' in tz
  hour:         number   // 0–23 in tz
  minute:       number   // 0–59 in tz
  minutes:      number   // minutes since midnight in tz — for time-of-day maths
  weekdayShort: string   // 'Mon' … 'Sun'
}

/**
 * The current date, time and weekday in `tz`, read in a single pass.
 *
 * hourCycle:'h23' is load-bearing: hour12:false renders midnight as hour "24"
 * on the server's ICU build, which has already caused a today's-events-
 * disappear bug here. Read as a number, "24" would put midnight past the end
 * of the day.
 */
export function nowInTz(tz: string = DEFAULT_TZ, now: Date = new Date()): TzNow {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz(tz),
    weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''

  const hour   = Number(get('hour'))
  const minute = Number(get('minute'))

  return {
    date:         `${get('year')}-${get('month')}-${get('day')}`,
    hour,
    minute,
    minutes:      hour * 60 + minute,
    weekdayShort: get('weekday'),
  }
}
