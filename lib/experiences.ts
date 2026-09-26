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

// One shelf per event. Each Experience tag is a shelf, in a curated order
// that covers every tag in the group (an unknown one sorts last, never
// disappears). An event carrying several Experience tags used to sit on
// every one of them, which turned 12 events into 20 cards and put a coastal
// walk under Nightlife and Sports; it now lands on the first of its tags in
// this order — its primary shelf — and nowhere else.
export const SHELF_ORDER = [
  'Outdoor', 'On the water', 'Adventure', 'Cultural', 'Music', 'Food',
  'Wellness', 'Dance', 'Film', 'Books', 'Sports', 'Games', 'Nightlife',
]

function shelfRank(name: string): number {
  const i = SHELF_ORDER.indexOf(name)
  return i === -1 ? SHELF_ORDER.length : i
}

/** The Experience tag an event is shelved under, or null when it has none. */
export function primaryShelf(event: { tags: ExperienceEventLike['tags'] }): { name: string; emoji: string } | null {
  let best: { name: string; emoji: string } | null = null
  for (const t of event.tags) {
    if (t.tag.group.name !== 'Experience') continue
    if (!best || shelfRank(t.tag.name) < shelfRank(best.name)) best = { name: t.tag.name, emoji: t.tag.emoji }
  }
  return best
}

// How each shelf reads in a sentence — lower-case, plural where a count of
// events would be, so "outdoor days, culture and food" scans as a list.
const SHELF_PHRASE: Record<string, string> = {
  'Outdoor':      'outdoor days',
  'On the water': 'days on the water',
  'Adventure':    'adventures',
  'Cultural':     'culture',
  'Music':        'live music',
  'Food':         'food',
  'Wellness':     'wellness',
  'Dance':        'dance',
  'Film':         'film',
  'Books':        'books',
  'Sports':       'sport',
  'Games':        'game nights',
  'Nightlife':    'nights out',
}

/**
 * The hero's opening list, built from the shelves that exist — "Outdoor
 * days, adventures, culture and food". The old line promised sailing,
 * workshops and day trips whatever was on the page; this one can only name
 * what a visitor is about to scroll past. Null when there are no shelves,
 * so the caller writes the honest empty line instead.
 */
export function describeShelves(shelfNames: string[]): string | null {
  const phrases = shelfNames.slice(0, 4).map(n => SHELF_PHRASE[n] ?? n.toLowerCase())
  if (phrases.length === 0) return null
  const text = phrases.length === 1 ? phrases[0]
    : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function chrono(a: SeriesGroupable, b: SeriesGroupable): number {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
}

export function buildShelves<T extends ExperienceEventLike>(events: T[]): ExperienceShelf<T>[] {
  const shelves = new Map<string, { emoji: string; events: T[] }>()
  for (const e of events) {
    const primary = primaryShelf(e)
    if (!primary) continue
    const shelf = shelves.get(primary.name) ?? { emoji: primary.emoji, events: [] }
    shelf.events.push(e)
    shelves.set(primary.name, shelf)
  }
  return [...shelves.entries()]
    .sort((a, b) => shelfRank(a[0]) - shelfRank(b[0]))
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
