// Day and time labels for direct messages, read on the member's city clock.
//
// Both labels used to be millisecond arithmetic: "Yesterday" meant "less than
// 48 hours ago" and the separator above it was the browser's own calendar day.
// Those two disagree every time a message lands near midnight — a 23:50
// message stamped "Yesterday 23:50" sat under a separator that already said
// Monday — and both answer for the wrong city the moment the reader is
// travelling. Calendar days in the city's timezone are the one answer the
// separator and the stamp underneath it can share.
import { DEFAULT_TZ, dayInTz, formatDay, safeTz } from '@/lib/cityTime'

/** The calendar day a message belongs to in `tz`, as 'YYYY-MM-DD'. */
export function dayKeyOf(iso: string, tz: string = DEFAULT_TZ): string {
  return dayInTz(new Date(iso), tz)
}

/** Clock time in `tz` — h23, never hour12:false (which renders 00:xx as 24:xx). */
export function clockOf(iso: string, tz: string = DEFAULT_TZ): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: safeTz(tz), hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Whole calendar days between two 'YYYY-MM-DD' days. Anchored at UTC noon so
 * no DST changeover in between can turn a day into 23 or 25 hours.
 */
export function daysBefore(day: string, today: string): number {
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86_400_000)
}

/**
 * The label on a day separator: Today, Yesterday, the weekday inside the last
 * week, otherwise the date — with the year on it once it isn't this year, so
 * "12 August" can't read as this August.
 */
export function daySeparator(day: string, today: string): string {
  const diff = daysBefore(day, today)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  // A negative diff means the clocks disagree (a fast device, a message from
  // "later today"); it falls through to the dated label rather than claiming
  // a weekday that hasn't happened.
  if (diff > 1 && diff < 7) return formatDay(day, { weekday: 'long' })
  return day.slice(0, 4) === today.slice(0, 4)
    ? formatDay(day, { weekday: 'short', day: 'numeric', month: 'long' })
    : formatDay(day, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** The stamp under a single message, phrased to match its separator. */
export function messageTime(iso: string, today: string, tz: string = DEFAULT_TZ): string {
  const day   = dayKeyOf(iso, tz)
  const clock = clockOf(iso, tz)
  const diff  = daysBefore(day, today)
  if (diff === 0) return clock
  if (diff === 1) return `Yesterday ${clock}`
  if (diff > 1 && diff < 7) return `${formatDay(day, { weekday: 'short' })} ${clock}`
  const opts: Intl.DateTimeFormatOptions = day.slice(0, 4) === today.slice(0, 4)
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' }
  return `${formatDay(day, opts)} ${clock}`
}

/** Relative age of a conversation for the inbox list. */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d}d ago`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
