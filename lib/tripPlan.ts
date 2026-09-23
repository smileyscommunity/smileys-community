import { isRealDate, MAX_VISIT_DAYS, MAX_LEAD_DAYS } from './visitorPolicy'
import { shiftDay } from './cityTime'
import { eventEndsAt, eventPhase, type EventClock } from './eventTime'
import { CITY_STATUS } from './cityStatus'
import { CITY_MATURITY, type CityMaturity } from './cityMaturity'

// The trip planner on /visiting: "I'm here from … to …" → the events during
// that stay, narrowed by what the traveller cares about. Pure, so the rules
// that keep it honest are tested:
//
//   · a range that has already ended is refused, and one that started in the
//     past is clamped to today — the planner never lists yesterday
//   · an event that has already finished today is dropped, one in progress is
//     labelled as such, so nothing past reads as upcoming
//   · a filter is offered only when it would actually narrow the list: no
//     "Free only" when everything is free, no language picker when no event
//     states a language

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export interface TripRange { from: string; to: string }

export interface ParsedTrip {
  /** The range to search, clamped to start no earlier than today. */
  range:   TripRange | null
  /** Why the dates entered can't be searched, or null. */
  error:   string | null
  /** True when the arrival date was in the past and was moved to today. */
  clamped: boolean
}

/** Read ?from=&to= (both 'YYYY-MM-DD'). No dates is not an error — it is "not planning yet". */
export function parseTripRange(q: { from?: string | null; to?: string | null }, today: string): ParsedTrip {
  const from = q.from?.trim() || ''
  const to   = q.to?.trim()   || ''
  if (!from && !to) return { range: null, error: null, clamped: false }
  if (!isRealDate(from) || !isRealDate(to)) return { range: null, error: 'Choose both an arrival and a departure date.', clamped: false }
  if (to < from) return { range: null, error: 'Your departure date is before your arrival date.', clamped: false }
  if (to < today) return { range: null, error: 'Those dates have already passed — choose an upcoming stay.', clamped: false }
  if (daysBetween(from, to) > MAX_VISIT_DAYS) return { range: null, error: `Plan up to ${MAX_VISIT_DAYS} days at a time.`, clamped: false }
  if (daysBetween(today, from) > MAX_LEAD_DAYS) return { range: null, error: 'The calendar only reaches a year ahead.', clamped: false }
  const clamped = from < today
  return { range: { from: clamped ? today : from, to }, error: null, clamped }
}

export interface TripFilters {
  hood:  string | null
  free:  boolean
  first: boolean
  lang:  string | null
}

export function parseTripFilters(q: { hood?: string | null; free?: string | null; first?: string | null; lang?: string | null }): TripFilters {
  return {
    hood:  q.hood?.trim()  || null,
    free:  q.free  === '1',
    first: q.first === '1',
    lang:  q.lang?.trim()  || null,
  }
}

export interface TripEvent extends EventClock {
  neighborhood: string
  price: number
  memberPrice?: number | null
  isFirstTimerFriendly: boolean
  language: string | null
}

/** Free to the viewer: a member price of 0 counts (the events feed's rule). */
export const isFreeEvent = (e: { price: number; memberPrice?: number | null }) => e.price === 0 || e.memberPrice === 0

export function applyTripFilters<E extends TripEvent>(events: E[], f: TripFilters): E[] {
  return events.filter(e =>
    (!f.hood  || e.neighborhood === f.hood) &&
    (!f.free  || isFreeEvent(e)) &&
    (!f.first || e.isFirstTimerFriendly) &&
    (!f.lang  || (e.language?.trim().toLowerCase() === f.lang.toLowerCase())),
  )
}

export interface TripFilterOptions {
  hoods: string[]        // offered when there are at least two to choose between
  free:  boolean         // offered when some are free and some are not
  first: boolean         // offered when some are first-timer friendly and some are not
  langs: string[]        // languages events actually state
}

/** The filters worth showing for this set of events (see the file note). */
export function tripFilterOptions(events: TripEvent[]): TripFilterOptions {
  const hoods = [...new Set(events.map(e => e.neighborhood).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'))
  const freeCount  = events.filter(isFreeEvent).length
  const firstCount = events.filter(e => e.isFirstTimerFriendly).length
  const langs = [...new Map(events
    .map(e => e.language?.trim())
    .filter((l): l is string => !!l)
    .map(l => [l.toLowerCase(), l] as const)).values()].sort()
  return {
    hoods: hoods.length >= 2 ? hoods : [],
    free:  freeCount > 0 && freeCount < events.length,
    first: firstCount > 0 && firstCount < events.length,
    langs,
  }
}

export type TripWhen = { kind: 'now' | 'today' | 'tomorrow' | 'later'; label: string }

/**
 * Where an event sits relative to now, in the city's own time — or null when
 * it has already finished and must not be listed at all.
 */
export function tripEventWhen(e: EventClock, tz: string, today: string, now: Date = new Date()): TripWhen | null {
  if (e.date < today) return null
  if (e.date === today) {
    if (eventEndsAt(e, tz).getTime() <= now.getTime()) return null
    if (eventPhase(e, tz, now) === 'live') return { kind: 'now', label: 'Happening now' }
    return { kind: 'today', label: 'Today' }
  }
  if (e.date === shiftDay(today, 1)) return { kind: 'tomorrow', label: 'Tomorrow' }
  const [y, m, d] = e.date.split('-').map(Number)
  const label = new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return { kind: 'later', label }
}

// ── Where a traveller can use Smileys today ────────────────────────────────

export type Availability = 'active' | 'founding' | 'coming_soon'

/**
 * The traveller's question — "will there be people and events when I get
 * there?" — answered from the same signals the city cards use: a live city
 * still in its seeding stage is Founding (few or no events yet), a live city
 * past it is Active, and anything not live is Coming soon.
 */
export function cityAvailability(c: { status: string; stats?: { maturity?: CityMaturity } | null }): Availability {
  if (c.status !== CITY_STATUS.Live) return 'coming_soon'
  return c.stats?.maturity === CITY_MATURITY.Seeding ? 'founding' : 'active'
}
