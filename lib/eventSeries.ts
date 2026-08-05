// Event series grouping (Events brief §38–39) — DISPLAY ONLY.
//
// The audit found 32 of 41 upcoming events carry a seriesId forming just
// 8 series (Picnic in Moda alone repeats 7 times), so a chronological
// feed shows the same plan over and over. Grouping collapses each series
// to its next occurrence with a "+N more dates" affordance: 41 cards
// become ~17 without hiding anything.
//
// Every occurrence remains a canonical Event record (§68) — nothing is
// merged, deduplicated or rewritten in the database.

export interface SeriesGroupable {
  id: string
  title: string
  date: string        // 'YYYY-MM-DD'
  time: string        // 'HH:MM'
  seriesId?: string | null
  isRecurring?: boolean
}

export interface SeriesGroup<T extends SeriesGroupable> {
  // The soonest occurrence — the one rendered as the card.
  next: T
  // Later occurrences of the same series, chronological.
  upcoming: T[]
  // Convenience for the card's "Every Wednesday · next Aug 12" line.
  isSeries: boolean
  seriesCount: number
}

// Chronological comparison for 'YYYY-MM-DD' + 'HH:MM' string columns —
// both sort correctly as strings, which is why the schema stores them
// this way.
function chrono(a: SeriesGroupable, b: SeriesGroupable): number {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
}

// Groups events by seriesId, preserving overall chronological order by
// each group's NEXT occurrence. Events without a seriesId pass through
// as single-item groups.
export function groupBySeries<T extends SeriesGroupable>(events: T[]): SeriesGroup<T>[] {
  const bySeries = new Map<string, T[]>()
  const standalone: T[] = []

  for (const e of events) {
    if (e.seriesId) {
      const list = bySeries.get(e.seriesId) ?? []
      list.push(e)
      bySeries.set(e.seriesId, list)
    } else {
      standalone.push(e)
    }
  }

  const groups: SeriesGroup<T>[] = []
  for (const list of bySeries.values()) {
    const sorted = [...list].sort(chrono)
    groups.push({
      next: sorted[0],
      upcoming: sorted.slice(1),
      isSeries: sorted.length > 1,
      seriesCount: sorted.length,
    })
  }
  for (const e of standalone) {
    groups.push({ next: e, upcoming: [], isSeries: false, seriesCount: 1 })
  }

  return groups.sort((a, b) => chrono(a.next, b.next))
}

// "Every Wednesday" when the series lands on a consistent weekday,
// otherwise a plain count. Returns null for non-series so the card can
// skip the line entirely rather than render an empty one.
export function seriesCadenceLabel(group: SeriesGroup<SeriesGroupable>): string | null {
  if (!group.isSeries) return null
  const all = [group.next, ...group.upcoming]
  const weekdays = new Set(all.map(e => new Date(`${e.date}T12:00:00+03:00`).getUTCDay()))
  if (weekdays.size === 1) {
    const name = new Date(`${group.next.date}T12:00:00+03:00`)
      .toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/Istanbul' })
    return `Every ${name}`
  }
  return `${group.seriesCount} upcoming dates`
}
