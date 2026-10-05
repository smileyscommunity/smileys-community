import { wallClockInTz, DEFAULT_TZ } from '@/lib/cityTime'

// The dashboard's "Hangouts today" strip. It used to count only hangouts that
// had already started, so one posted for 19:00 was invisible all afternoon —
// right when someone could still decide to go. Live ones and ones starting
// within the next day now share the strip.

export const HANGOUTS_SOON_MS = 24 * 60 * 60 * 1000

export interface StripHangout {
  id:           string
  title:        string
  neighborhood: string | null
  startsAt:     Date
  endsAt:       Date
}

export interface HangoutsToday {
  live:      number
  upcoming:  number
  liveHood:  string | null
  next:      { id: string; title: string; neighborhood: string | null; time: string; tomorrow: boolean } | null
}

/** Live and still-to-come hangouts, summarised on the city's clock. */
export function summarizeHangoutsToday(rows: StripHangout[], now: Date, tz: string = DEFAULT_TZ): HangoutsToday {
  const live     = rows.filter(h => h.startsAt <= now && h.endsAt > now)
  const upcoming = rows.filter(h => h.startsAt > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  const n        = upcoming[0]
  const wall     = n ? wallClockInTz(n.startsAt, tz) : ''
  return {
    live:     live.length,
    upcoming: upcoming.length,
    liveHood: live[0]?.neighborhood ?? null,
    next: n
      ? { id: n.id, title: n.title, neighborhood: n.neighborhood, time: wall.slice(11, 16), tomorrow: wall.slice(0, 10) !== wallClockInTz(now, tz).slice(0, 10) }
      : null,
  }
}
