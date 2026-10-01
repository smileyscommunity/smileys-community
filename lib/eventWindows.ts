// The date windows behind /[city]/events/today, /this-week and /this-weekend:
// crawlable pages for the searches people actually type ("events this
// weekend"). Pure, string-date maths in the city's own zone (lib/cityTime), so
// a window never reads a day early west of UTC. "Weekend" here is Friday to
// Sunday (Nate, 2026-10-02): Friday evening is when the weekend's plans start,
// and several weekly events run then. The members' calendar Weekend pill is
// still Saturday–Sunday (weekendRangeOf), a different, older definition.

import { weekRangeOf, shiftDay, formatDay } from './cityTime'

export const EVENT_WINDOWS = ['today', 'this-week', 'this-weekend'] as const
export type EventWindow = (typeof EVENT_WINDOWS)[number]

export function isEventWindow(v: string): v is EventWindow {
  return (EVENT_WINDOWS as readonly string[]).includes(v)
}

/** Inclusive day range for a window; never starts before today. */
export function windowRange(w: EventWindow, today: string): { start: string; end: string } {
  if (w === 'today') return { start: today, end: today }
  if (w === 'this-week') return { start: today, end: weekRangeOf(today).end }
  // Friday–Sunday of this week: Monday–Thursday it is the coming one, on
  // Friday–Sunday it is this one, minus any day that has already gone.
  const { start: mon, end } = weekRangeOf(today)
  const start = shiftDay(mon, 4)
  return { start: start < today ? today : start, end }
}

export function inWindow<T extends { date: string }>(events: T[], w: EventWindow, today: string): T[] {
  const { start, end } = windowRange(w, today)
  return events.filter(e => e.date >= start && e.date <= end)
}

export const WINDOW_LABEL: Record<EventWindow, string> = {
  'today': 'today',
  'this-week': 'this week',
  'this-weekend': 'this weekend',
}

/** "Sat 3 Oct – Sun 4 Oct", or a single day. */
export function windowDates(w: EventWindow, today: string): string {
  const { start, end } = windowRange(w, today)
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`
}
