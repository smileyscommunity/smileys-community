// Time helpers for the Hangouts page — split out of the page component so
// the chip/badge logic is unit-testable with a controlled clock. All
// day/hour maths in Istanbul wall-clock, matching the rest of the page.
const TZ = 'Europe/Istanbul'

export type TimeFilter = 'all' | 'now' | 'today' | 'tonight' | 'tomorrow' | 'week'

const istanbulDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })

// Time chips (plan's Now / Today / Tonight / Tomorrow). All day/hour maths
// in Istanbul wall-clock, same as everything else on this page. "Now" also
// admits anything starting within the hour — a chip that hides a hangout
// starting in ten minutes would be answering the wrong question.
export function matchesTimeFilter(h: { startsAt: string; endsAt: string }, f: TimeFilter, now = new Date()): boolean {
  if (f === 'all') return true
  const s = new Date(h.startsAt), e = new Date(h.endsAt)
  const live = s <= now && e > now
  if (f === 'now') return live || (s > now && s.getTime() - now.getTime() <= 60 * 60_000)
  const startsToday    = istanbulDay(s) === istanbulDay(now)
  const startsTomorrow = istanbulDay(s) === istanbulDay(new Date(now.getTime() + 86_400_000))
  if (f === 'today')    return live || startsToday
  if (f === 'tomorrow') return startsTomorrow
  if (f === 'week')     return live || (s > now && s.getTime() - now.getTime() <= 7 * 86_400_000)
  // tonight: starts today from 17:00 Istanbul onwards (or is live into it)
  const startHour = parseInt(s.toLocaleTimeString('en-GB', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit' }), 10)
  return (live || startsToday) && startHour >= 17
}

// Card status chip (plan §10). Live cards already carry the pulsing green
// treatment, so this only colours the future: starting-soon amber, tonight
// blue, tomorrow neutral. Anything further out gets no chip — the time
// label says it better.
export function statusBadge(startsAt: string, endsAt: string, now = new Date()): { label: string; cls: string } | null {
  const s = new Date(startsAt)
  if (s <= now) return null
  const mins = Math.round((s.getTime() - now.getTime()) / 60_000)
  if (mins <= 60) return { label: `Starting in ${mins}m`, cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' }
  const startsToday = istanbulDay(s) === istanbulDay(now)
  const startHour = parseInt(s.toLocaleTimeString('en-GB', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit' }), 10)
  if (startsToday && startHour >= 17) return { label: 'Tonight', cls: 'bg-blue-100 text-blue-800 border-blue-200' }
  if (istanbulDay(s) === istanbulDay(new Date(now.getTime() + 86_400_000)))
    return { label: 'Tomorrow', cls: 'bg-gray-100 text-gray-600 border-gray-200' }
  return null
}

