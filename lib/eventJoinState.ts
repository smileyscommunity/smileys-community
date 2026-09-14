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

export type JoinBlock = 'cancelled' | 'postponed' | 'closed' | 'deadline' | 'ended' | 'started' | null

export interface JoinableEvent extends EventClock {
  status?: string | null
  /** Optional 'YYYY-MM-DD'. Anything else is ignored, exactly as the route does. */
  registrationDeadline?: string | null
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
  const today = dayInTz(now, tz)
  if (event.date < today) return 'ended'

  // The registration deadline. The route has refused a join past it since it
  // started reading the field, but this module never knew about it, so the
  // page and the cards kept offering a Join button that could only produce an
  // error toast — the exact failure this file exists to prevent. Same predicate
  // as the route, well-formed check included: two archived rows hold '20260730'
  // and '09/07/2026' from before the format was enforced, and a bare compare
  // would read those as long past and shut an open event.
  if (event.registrationDeadline
      && /^\d{4}-\d{2}-\d{2}$/.test(event.registrationDeadline)
      && event.registrationDeadline < today) return 'deadline'
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
  deadline:  'Registration closed',
  ended:     'Event ended',
  started:   'Already started',
}

export function joinBlockLabel(block: JoinBlock): string | null {
  return block ? JOIN_BLOCK_LABEL[block] : null
}

// ── Which label the card's button wears ─────────────────────────────────────
//
// The card used to put the closed label over everything except "✓ Joined" on
// a started/ended event, so a member pending behind a passed registration
// deadline read "Registration closed" days before the event — as if her
// request were gone. RSVPButton on the event page had it right all along: the
// closed label is for someone with no place on the event (idle, error, or
// still loading their status); anyone joined, pending or waitlisted sees
// where they stand, for EVERY closed reason — cancelled and postponed
// included (the card's "Cancelled" ribbon and red button still say the event
// is off; the page's button says "You're attending" there too). One rule for
// both, so they can't drift again.

export type Participation = 'idle' | 'joined' | 'pending' | 'waitlisted' | 'loading' | 'error'

export type CardButtonState =
  | { kind: 'closed'; block: Exclude<JoinBlock, null>; label: string }
  | { kind: 'mine';   status: 'joined' | 'pending' | 'waitlisted' }
  | { kind: 'open' }

export function cardButtonState(block: JoinBlock, participation: Participation): CardButtonState {
  if (participation === 'joined' || participation === 'pending' || participation === 'waitlisted') {
    return { kind: 'mine', status: participation }
  }
  if (block) return { kind: 'closed', block, label: JOIN_BLOCK_LABEL[block] }
  return { kind: 'open' }
}
