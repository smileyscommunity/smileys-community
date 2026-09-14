// ── Can a member still join this event? ─────────────────────────────────────
//
// The RSVP route refuses a join on anything not published, on a past day, or
// once the event has started (app/api/events/[id]/rsvp). The cards and the
// event page kept showing a working Join button on cancelled, finished and
// in-progress events — every tap an error toast. This is the same rule, as a
// label the UI can show instead of the button.
//
// Client-safe: no database import (lib/eventTime and lib/cityTime are too).

import { eventEndsAt, eventPhase, eventStartsAt, type EventClock } from '@/lib/eventTime'
import { DEFAULT_TZ, dayInTz } from '@/lib/cityTime'

export type JoinBlock = 'cancelled' | 'postponed' | 'closed' | 'ended' | 'started' | null

export interface JoinableEvent extends EventClock {
  status?: string | null
}

const HHMM = /^\d{1,2}:\d{2}/

/** Why joining is shut, or null when the Join button is honest. */
export function joinBlock(event: JoinableEvent, tz: string = DEFAULT_TZ, now: Date = new Date()): JoinBlock {
  const status = event.status ?? 'published'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'postponed') return 'postponed'
  if (status !== 'published') return 'closed'

  // Past calendar day on the event city's clock — the route's first date
  // gate, the same bare string compare, so a garbled date answers the same
  // way here as there.
  if (event.date < dayInTz(now, tz)) return 'ended'
  // Guard the Date math below against a garbled row: the server never
  // treats bad data as "started", so neither does the button.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return null

  const t = now.getTime()
  const end = eventEndsAt(event, tz).getTime()
  if (Number.isFinite(end) && t >= end) return 'ended'
  if (eventPhase(event, tz, now) === 'live') return 'started'
  // A TBA time has no start; the route counts it as started only at its end,
  // which the 'ended' check above already covers. A known start that has
  // passed but has no phase (shouldn't happen) is still started.
  if (event.time && HHMM.test(event.time)) {
    const start = eventStartsAt(event, tz).getTime()
    if (Number.isFinite(start) && t >= start) return 'started'
  }
  return null
}

export const JOIN_BLOCK_LABEL: Record<Exclude<JoinBlock, null>, string> = {
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  closed:    'Not open for RSVPs',
  ended:     'Event ended',
  started:   'Already started',
}

export function joinBlockLabel(block: JoinBlock): string | null {
  return block ? JOIN_BLOCK_LABEL[block] : null
}
