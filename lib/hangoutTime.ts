// Time helpers for the Hangouts page — split out of the page component so
// the chip/badge logic is unit-testable with a controlled clock. All
// day/hour maths on the VIEWED city's wall clock, passed in by the caller
// (useCurrentCity().timezone); the default city's zone is only the
// fallback while that resolves.
import { DEFAULT_TZ } from './cityTime'

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
  const startsTomorrow = cityDay(s, tz) === cityDay(new Date(now.getTime() + 86_400_000), tz)
  if (f === 'today')    return live || startsToday
  if (f === 'tomorrow') return startsTomorrow
  if (f === 'week')     return live || (s > now && s.getTime() - now.getTime() <= 7 * 86_400_000)
  // tonight: starts today from 17:00 on the city's clock (or is live into it)
  return (live || startsToday) && cityHour(s, tz) >= 17
}

// Card status chip (plan §10). Live cards already carry the pulsing green
// treatment, so this only colours the future: starting-soon amber, tonight
// blue, tomorrow neutral. Anything further out gets no chip — the time
// label says it better.
export function statusBadge(startsAt: string, endsAt: string, now = new Date(), tz: string = DEFAULT_TZ): { label: string; cls: string } | null {
  const s = new Date(startsAt)
  if (s <= now) return null
  const mins = Math.round((s.getTime() - now.getTime()) / 60_000)
  if (mins <= 60) return { label: `Starting in ${mins}m`, cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' }
  const startsToday = cityDay(s, tz) === cityDay(now, tz)
  if (startsToday && cityHour(s, tz) >= 17) return { label: 'Tonight', cls: 'bg-blue-100 text-blue-800 border-blue-200' }
  if (cityDay(s, tz) === cityDay(new Date(now.getTime() + 86_400_000), tz))
    return { label: 'Tomorrow', cls: 'bg-gray-100 text-gray-600 border-gray-200' }
  return null
}

