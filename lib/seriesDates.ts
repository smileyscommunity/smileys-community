import { shiftDay } from './cityTime'

export type SeriesRepeat = 'none' | 'weekly' | 'biweekly' | 'monthly'

/**
 * The day a monthly series lands on `months` after `start`, both bare
 * 'YYYY-MM-DD' days. The day of the month is kept, and clamped to the month's
 * last day when that month is shorter: a series starting on 31 January runs
 * 28 (or 29) February, 31 March, 30 April.
 *
 * The create form used Date#setMonth, which overflows instead — 31 January
 * plus one month is "31 February", i.e. 3 March — so a series started late
 * in the month skipped February and ran twice in March.
 */
export function addMonthsClamped(start: string, months: number): string {
  const y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)) - 1, d = Number(start.slice(8, 10))
  const total = y * 12 + m + months
  const ty = Math.floor(total / 12), tm = total % 12
  // Day 0 of the next month is the last day of this one (UTC, so no zone).
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

/**
 * Every date of a series, first one included. Calendar maths on the day
 * strings alone: a local-zone Date round-tripped through toISOString could
 * land a day off across a DST change or west of UTC.
 */
export function seriesDates(start: string, repeat: SeriesRepeat, count: number): string[] {
  if (repeat === 'none' || !start) return [start]
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.push(repeat === 'monthly' ? addMonthsClamped(start, i) : shiftDay(start, (repeat === 'weekly' ? 7 : 14) * i))
  }
  return out
}
