import { DEFAULT_TZ, fromWallClockInTz } from './cityTime'
// Quarterly Net Promoter Score helpers — shared across the cron
// dispatcher, the member-facing form, the submit endpoint, and the
// admin rollup. Single source of truth for period naming and score-
// band classification so an off-by-one in one place doesn't drift
// numbers in another.
//
// Period naming: "YYYY-Qn" Istanbul time. Quarters are Jan-Mar (Q1),
// Apr-Jun (Q2), Jul-Sep (Q3), Oct-Dec (Q4). We use Istanbul time
// because every other dashboard does — keeping the quarter boundary
// in lockstep with what admins read on the calendar.
//
// Score bands: 9–10 promoter, 7–8 passive, 0–6 detractor. NPS =
// %promoters − %detractors, integer in the −100…+100 range, null
// when no responses.

import { prisma } from '@/lib/prisma'

export type ScoreBand = 'promoter' | 'passive' | 'detractor'

export function classify(score: number): ScoreBand {
  if (score >= 9) return 'promoter'
  if (score >= 7) return 'passive'
  return 'detractor'
}

// Returns "YYYY-Qn" for the given date in Istanbul time. Defaults to
// now. The Intl trick gives us TZ-correct month/year without dragging
// in a date library.
export function periodFor(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TZ,
    year:  'numeric',
    month: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  const year  = parts.find(p => p.type === 'year')!.value
  const month = parseInt(parts.find(p => p.type === 'month')!.value, 10)
  const quarter = Math.ceil(month / 3)
  return `${year}-Q${quarter}`
}

// Returns the instant the given period starts, on `tz`'s clock. Used by the
// dispatch cron to decide "is today inside the first 14 days of the
// quarter?" — the window in which we send the nudge. NPS is one network-wide
// survey, so it runs on the founding city's clock by default; a per-city
// rollout passes the city's zone.
export function periodStartDate(period: string, tz: string = DEFAULT_TZ): Date {
  const match = period.match(/^(\d{4})-Q([1-4])$/)
  if (!match) throw new Error(`Invalid period: ${period}`)
  const year    = parseInt(match[1], 10)
  const quarter = parseInt(match[2], 10)
  const month   = (quarter - 1) * 3 + 1  // 1, 4, 7, 10
  return fromWallClockInTz(`${year}-${String(month).padStart(2, '0')}-01T00:00`, tz)
}

export interface NPSRollup {
  period:        string
  responses:     number
  promoters:     number
  passives:      number
  detractors:    number
  promoterPct:   number | null  // 0–100
  passivePct:    number | null
  detractorPct:  number | null
  nps:           number | null  // −100 to +100
  avgScore:      number | null  // 0–10, 1 decimal
}

// Aggregates a set of {score} rows into the standard rollup. Used by
// the admin endpoint to compute per-period stats from a single
// findMany. Counts-with-predicates pattern would also work but a
// single-pass JS reduce over the rows keeps the bands in one place.
export function summarize(period: string, rows: { score: number }[]): NPSRollup {
  const responses = rows.length
  if (responses === 0) {
    return {
      period, responses: 0,
      promoters: 0, passives: 0, detractors: 0,
      promoterPct: null, passivePct: null, detractorPct: null,
      nps: null, avgScore: null,
    }
  }
  let promoters = 0, passives = 0, detractors = 0
  let scoreSum  = 0
  for (const r of rows) {
    const b = classify(r.score)
    if (b === 'promoter')  promoters++
    else if (b === 'passive') passives++
    else                   detractors++
    scoreSum += r.score
  }
  const promoterPct  = Math.round((promoters  / responses) * 100)
  const detractorPct = Math.round((detractors / responses) * 100)
  return {
    period, responses,
    promoters, passives, detractors,
    promoterPct,
    passivePct:   Math.round((passives  / responses) * 100),
    detractorPct,
    nps:          promoterPct - detractorPct,
    avgScore:     Math.round((scoreSum / responses) * 10) / 10,
  }
}

// Eligibility floor — members who joined less than `minDays` ago
// haven't had enough community exposure for their NPS to be
// signal. Used by both the dispatch cron and the form's "are you
// eligible?" guard.
export const MIN_DAYS_FOR_NPS = 30

// Returns the cutoff Date: anyone with joinedAt > cutoff is too new.
export function eligibilityCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - MIN_DAYS_FOR_NPS * 24 * 60 * 60 * 1000)
}

// Quick wrapper: does this user have a response for the given period?
// Used by the form GET to decide whether to render the form or the
// thanks state.
