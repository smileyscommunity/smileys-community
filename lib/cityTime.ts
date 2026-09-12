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
  // Shift the city's calendar day, not the instant. "Now + 24h" read back in
  // a DST zone repeats a date (or skips one) in the hour beside the change:
  // 00:30 on Berlin's fall-back morning gave "tomorrow" as today.
  const today = dayInTz(new Date(), tz)
  return offsetDays ? shiftDay(today, offsetDays) : today
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

/**
 * The instant at which `tz` reads `hour:00` on its own today.
 *
 * "Tonight at 19:00" is a statement about the city's clock, and the hangouts
 * composer used to build it as `Date.UTC(y, m, d, 19 - 3)` — 19:00 minus a
 * hand-written UTC+3. That is correct for exactly one city, and wrong twice a
 * year for any city that observes DST.
 *
 * Derived from the offset between now and the city's current clock, so it
 * needs no offset table and no assumption about which city this is. Returns a
 * moment earlier today when `hour` has already passed; callers decide what
 * that means (the composer pushes it to "half an hour from now").
 */
export function atHourInTz(hour: number, tz: string = DEFAULT_TZ, now: Date = new Date()): Date {
  // Anchored on the city's calendar day and parsed back through the
  // wall-clock inverse below, so a DST changeover between now and `hour`
  // (spring-forward morning, asking for the evening) doesn't shift it by
  // an hour the way "now + (hour − minutesNow)" did.
  const { date } = nowInTz(tz, now)
  return fromWallClockInTz(`${date}T${String(hour).padStart(2, '0')}:00`, tz)
}

/**
 * A Date rendered as a `datetime-local` value ('YYYY-MM-DDTHH:MM') on `tz`'s
 * clock, and its inverse.
 *
 * A hangout's meet time is the CITY's wall clock: "18:30" means half six where
 * the plan is, whatever the creator's laptop says. The pair used to hardcode
 * the founding city — format via its zone, parse by tagging '+03:00' — which
 * silently mis-files a plan by the offset difference for any other city, and
 * breaks twice a year anywhere with DST.
 *
 * The inverse works by measuring what the city's clock actually reads at a
 * first guess and correcting by the difference, so it needs no offset table.
 * A time inside a DST spring-forward gap has no real instant; that resolves to
 * the moment just after the jump, which is the least surprising answer.
 */
export function wallClockInTz(d: Date, tz: string = DEFAULT_TZ): string {
  // sv-SE gives 'YYYY-MM-DD HH:MM:SS'; swap the space and drop seconds.
  return d.toLocaleString('sv-SE', { timeZone: safeTz(tz) }).replace(' ', 'T').slice(0, 16)
}

/**
 * A bare calendar day ('YYYY-MM-DD') rendered as a label — "Wed 9 Sep".
 *
 * A date string is a day, not an instant, so its weekday is the same in every
 * timezone and needs no zone to render. The old idiom, `new Date(date +
 * 'T12:00:00+03:00')`, pinned noon in the founding city to make the browser's
 * local formatting land on the right day; that is an offset literal in six
 * places doing the job of "format this day". Anchor at UTC noon and format in
 * UTC instead, and the result is right for any city and any viewer.
 */
export function formatDay(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }, locale = 'en-GB'): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { ...opts, timeZone: 'UTC' })
}

/** 0 (Sunday) … 6 for a bare calendar day, zone-free for the same reason. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

/**
 * First calendar day an event's discussion is closed: day 15 after the
 * event, i.e. the end of day 14. One rule for the POST and PATCH guards and
 * the composer; each used to do its own date maths on a different clock.
 */
export function discussionLockDay(eventDate: string): string {
  return shiftDay(eventDate, 15)
}

/** 'YYYY-MM-DD' moved by n days, on the calendar alone — no zone, no DST. */
export function shiftDay(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Monday…Sunday of the week that contains `today`, as date strings, so an
 * event's text date compares directly. The events filter used to build these
 * from the browser's `new Date()` and compare against `new Date('YYYY-MM-DD')`
 * — UTC midnight — so west of UTC a Monday event read as Sunday evening and
 * fell out of "This week".
 */
export function weekRangeOf(today: string): { start: string; end: string } {
  const start = shiftDay(today, -((weekdayOf(today) + 6) % 7))
  return { start, end: shiftDay(start, 6) }
}

/**
 * Saturday–Sunday of the week that contains `today`. On a Sunday that is
 * yesterday and today: the old maths took the NEXT Saturday and hid the
 * Sunday events a member was looking for that same afternoon.
 */
export function weekendRangeOf(today: string): { start: string; end: string } {
  const { start: mon } = weekRangeOf(today)
  return { start: shiftDay(mon, 5), end: shiftDay(mon, 6) }
}

const WALL_DAY_MS = 86_400_000

export function fromWallClockInTz(value: string, tz: string = DEFAULT_TZ): Date {
  const asIfUtc = new Date(`${value}:00Z`).getTime()
  if (!Number.isFinite(asIfUtc)) return new Date(NaN)
  // What the city's clock reads at an instant, read back as if it were UTC:
  // the gap between the two IS the city's offset at that moment.
  const readAt   = (t: number) => new Date(`${wallClockInTz(new Date(t), tz)}:00Z`).getTime()
  const offsetAt = (t: number) => readAt(t) - t
  // The offsets a day either side bracket any single DST change (changes are
  // months apart), giving the two instants the answer can be. Measuring at the
  // asked-for time itself, as this used to, reads the wrong side of the jump
  // west of UTC: 02:30 on New York's spring-forward morning came back as
  // 01:30 EST, and Santiago's midnight change put a day's 00:00 on the day
  // before.
  const before = asIfUtc - offsetAt(asIfUtc - WALL_DAY_MS)
  const after  = asIfUtc - offsetAt(asIfUtc + WALL_DAY_MS)
  const okBefore = readAt(before) === asIfUtc
  const okAfter  = readAt(after)  === asIfUtc
  // A time that happens twice (the fall-back hour) takes the first. A time
  // inside a spring-forward gap reads back on neither; the pre-change offset
  // carries it just past the jump (03:30 on the day 03:00 becomes 04:00 lands
  // on 04:30). Without DST both candidates are the same instant.
  if (okBefore && okAfter) return new Date(Math.min(before, after))
  if (okAfter)             return new Date(after)
  return new Date(before)
}
