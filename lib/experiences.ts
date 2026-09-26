// Experiences page rules (app/experiences) — pure, so they can be pinned by
// tests without a database.
//
// The page is a curated read over Experience-tagged events. Two rules used to
// live inline there and disagreed with the events feed:
//   - "upcoming" was date >= today with no time cutoff, so a 10:30 hike sat on
//     the first shelf until midnight;
//   - cancelled occurrences were filtered out at the query, so a Sunday's
//     cancelled sailing simply vanished while the feed shows it with a banner.
// Both now mirror lib/db.getUpcomingEvents.

import { groupBySeries, seriesCadenceLabel, type SeriesGroupable } from './eventSeries'
import { isSoldOut, type SoldOutFields } from './soldOut'
import type { TzNow } from './cityTime'

// Same grace as the events feed: an event stays "upcoming" for 5h after its
// start (in progress), then drops. Clamped at 00:00 — yesterday's late events
// are already gone via the date bound.
export const STARTED_GRACE_MINUTES = 300

export function experienceWindow(now: TzNow): { today: string; cutoffTime: string } {
  const cutoffMins = Math.max(0, now.minutes - STARTED_GRACE_MINUTES)
  const cutoffTime = `${String(Math.floor(cutoffMins / 60)).padStart(2, '0')}:${String(cutoffMins % 60).padStart(2, '0')}`
  return { today: now.date, cutoffTime }
}

export interface ExperienceEventLike extends SeriesGroupable, SoldOutFields {
  status: string
  tags: { tag: { name: string; emoji: string; group: { name: string } } }[]
}

export interface ExperienceCard<T extends ExperienceEventLike> {
  event: T
  cadence: string | null
  // Later dates of the same series, chronological — the first two are shown,
  // the rest counted.
  moreDates: string[]
  moreCount: number
  // Cancelled occurrences that fall BEFORE `event` — the Sunday this series
  // skips. Rendered as a line so a member who saw the date doesn't think the
  // whole series is gone.
  cancelledDates: string[]
  cancelled: boolean
  soldOut: boolean
}

export interface ExperienceShelf<T extends ExperienceEventLike> {
  name: string
  emoji: string
  cards: ExperienceCard<T>[]
}

// Shelf per Experience tag, in a stable curated order; an event with two
// experience tags appears on both shelves (that's what shelves are for).
export const SHELF_ORDER = ['Outdoor', 'Adventure', 'Cultural', 'Food', 'Wellness']

function chrono(a: SeriesGroupable, b: SeriesGroupable): number {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
}

export function buildShelves<T extends ExperienceEventLike>(events: T[]): ExperienceShelf<T>[] {
  const shelves = new Map<string, { emoji: string; events: T[] }>()
  for (const e of events) {
    for (const t of e.tags) {
      if (t.tag.group.name !== 'Experience') continue
      const shelf = shelves.get(t.tag.name) ?? { emoji: t.tag.emoji, events: [] }
      shelf.events.push(e)
      shelves.set(t.tag.name, shelf)
    }
  }
  return [...shelves.entries()]
    .sort((a, b) => {
      const ia = SHELF_ORDER.indexOf(a[0]); const ib = SHELF_ORDER.indexOf(b[0])
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    .map(([name, s]) => ({ name, emoji: s.emoji, cards: buildCards(s.events) }))
}

export function buildCards<T extends ExperienceEventLike>(events: T[]): ExperienceCard<T>[] {
  const live      = events.filter(e => e.status !== 'cancelled')
  const cancelled = events.filter(e => e.status === 'cancelled')

  // A series is carded on its next LIVE occurrence; cancelled ones before it
  // become the card's "skipped" line rather than the card itself.
  const liveCards: ExperienceCard<T>[] = groupBySeries(live).map(g => ({
    event: g.next,
    cadence: seriesCadenceLabel(g),
    moreDates: g.upcoming.slice(0, 2).map(e => e.date),
    moreCount: g.upcoming.length,
    cancelledDates: g.next.seriesId
      ? cancelled.filter(c => c.seriesId === g.next.seriesId && chrono(c, g.next) < 0).map(c => c.date)
      : [],
    cancelled: false,
    soldOut: isSoldOut(g.next),
  }))

  // A cancelled event with no live sibling (standalone, or a series whose every
  // upcoming date is cancelled) keeps a card, stamped — same as the feed.
  const orphans = cancelled.filter(c => !c.seriesId || !live.some(l => l.seriesId === c.seriesId))
  const cancelledCards: ExperienceCard<T>[] = groupBySeries(orphans).map(g => ({
    event: g.next, cadence: seriesCadenceLabel(g),
    moreDates: [], moreCount: 0, cancelledDates: [],
    cancelled: true, soldOut: false,
  }))

  return [...liveCards, ...cancelledCards].sort((a, b) => chrono(a.event, b.event))
}
