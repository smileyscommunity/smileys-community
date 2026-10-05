// Time helpers for the Hangouts page — split out of the page component so
// the chip/badge logic is unit-testable with a controlled clock. All
// day/hour maths on the VIEWED city's wall clock, passed in by the caller
// (useCurrentCity().timezone); the default city's zone is only the
// fallback while that resolves.
import { DEFAULT_TZ, shiftDay } from './cityTime'

// A plan, not a calendar: spontaneous means within the fortnight (the API
// refuses a start further out on create and edit).
export const MAX_HANGOUT_LEAD_DAYS = 14
// Longest a single hangout can run. Was 24h; weekend trips and multi-day
// meetups were being rejected. Still capped so the feed can't be parked on.
export const MAX_HANGOUT_DURATION_DAYS = 7

export type TimeFilter = 'all' | 'now' | 'today' | 'tonight' | 'tomorrow' | 'week'

const cityDay  = (d: Date, tz: string) => d.toLocaleDateString('en-CA', { timeZone: tz })
const cityHour = (d: Date, tz: string) => parseInt(d.toLocaleTimeString('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit' }), 10)

// Time chips (plan's Now / Today / Tonight / Tomorrow). All day/hour maths
// in Istanbul wall-clock, same as everything else on this page. "Now" also
// admits anything starting within the hour — a chip that hides a hangout
// starting in ten minutes would be answering the wrong question.
export function matchesTimeFilter(h: { startsAt: string; endsAt: string }, f: TimeFilter, now = new Date(), tz: string = DEFAULT_TZ): boolean {
  if (f === 'all') return true
  const s = new Date(h.startsAt), e = new Date(h.endsAt)
  const live = s <= now && e > now
  if (f === 'now') return live || (s > now && s.getTime() - now.getTime() <= 60 * 60_000)
  const startsToday    = cityDay(s, tz) === cityDay(now, tz)
  // On the calendar (shiftDay), not +24h: on a clock-change night +24h lands on the same day.
  const startsTomorrow = cityDay(s, tz) === shiftDay(cityDay(now, tz), 1)
  if (f === 'today')    return live || startsToday
  if (f === 'tomorrow') return startsTomorrow
  if (f === 'week')     return live || (s > now && s.getTime() - now.getTime() <= 7 * 86_400_000)
  // tonight: starts today from 17:00 on the city's clock (or is live into it)
  return (live || startsToday) && cityHour(s, tz) >= 17
}

// Card status chip (plan §10). Live cards already carry the pulsing green
// treatment, so this only colors the future: starting-soon amber, tonight
// blue, tomorrow neutral. Anything further out gets no chip — the time
// label says it better.
export function statusBadge(startsAt: string, endsAt: string, now = new Date(), tz: string = DEFAULT_TZ): { label: string; cls: string } | null {
  const s = new Date(startsAt)
  if (s <= now) return null
  const mins = Math.round((s.getTime() - now.getTime()) / 60_000)
  if (mins <= 60) return { label: `Starting in ${mins}m`, cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' }
  const startsToday = cityDay(s, tz) === cityDay(now, tz)
  if (startsToday && cityHour(s, tz) >= 17) return { label: 'Tonight', cls: 'bg-blue-100 text-blue-800 border-blue-200' }
  if (cityDay(s, tz) === shiftDay(cityDay(now, tz), 1))
    return { label: 'Tomorrow', cls: 'bg-gray-100 text-gray-600 border-gray-200' }
  return null
}


// "Mon Oct 5" — the city's calendar day, American order, no comma.
export function hangoutDayLabel(d: Date, tz: string = DEFAULT_TZ): string {
  return d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
}
const hangoutTime = (d: Date, tz: string) => d.toLocaleTimeString('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })

// The window line on a hangout card. A hangout that ends on a different day
// than it starts names both days ("Mon Oct 5 – Wed Oct 8 · 09:00–20:00"):
// with up to 7 days allowed, "Today · 09:00–20:00 (next day)" no longer tells
// the reader how long it runs. Same-day hangouts keep the Now / In Nm / Today
// prefixes.
export function formatHangoutWindow(startsAt: string, endsAt: string, tz: string = DEFAULT_TZ, now = new Date()): string {
  const s = new Date(startsAt), e = new Date(endsAt)
  const times = `${hangoutTime(s, tz)}–${hangoutTime(e, tz)}`
  if (cityDay(s, tz) !== cityDay(e, tz)) return `${hangoutDayLabel(s, tz)} – ${hangoutDayLabel(e, tz)} · ${times}`
  const minsToStart = Math.round((s.getTime() - now.getTime()) / 60_000)
  let prefix: string
  if (minsToStart < 0)       prefix = 'Now · '
  else if (minsToStart < 60) prefix = `In ${minsToStart}m · `
  else if (cityDay(s, tz) === cityDay(now, tz)) prefix = 'Today · '
  else prefix = `${hangoutDayLabel(s, tz)} · `
  return `${prefix}${times}`
}

// "until 20:00", or "until Wed Oct 8, 20:00" when that is not today.
export function hangoutUntilLabel(endsAt: Date, tz: string = DEFAULT_TZ, now = new Date()): string {
  const t = hangoutTime(endsAt, tz)
  return cityDay(endsAt, tz) === cityDay(now, tz) ? `until ${t}` : `until ${hangoutDayLabel(endsAt, tz)}, ${t}`
}
