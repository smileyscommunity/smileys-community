import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { monthRangeFor } from '@/lib/cityTime'

// Sixth scan, batch 27 — neighbourhood event stats.
//   Neighbourhood HeroStats' "events this month" had only a lower bound
//   (date >= the 1st), so it counted every later month too, and neither it
//   nor "past events" filtered on status: drafts, pending, flagged and
//   cancelled events were counted on a public page. Rule now: public and
//   actually held — status IN ('published','archived'); cancelled and
//   postponed excluded. Same-page siblings (NeighborhoodSections, index) got
//   the matching status filter.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

describe('monthRangeFor', () => {
  it('mid-month: the 1st up to (not including) next month\'s 1st', () => {
    expect(monthRangeFor('2026-09-15')).toEqual({ start: '2026-09-01', nextStart: '2026-10-01' })
  })

  it('a 31-day month keeps its last day inside the range', () => {
    const r = monthRangeFor('2026-01-31')
    expect(r).toEqual({ start: '2026-01-01', nextStart: '2026-02-01' })
    expect('2026-01-31' >= r.start && '2026-01-31' < r.nextStart).toBe(true)
    expect('2026-02-01' < r.nextStart).toBe(false)
  })

  it('February in a leap year includes the 29th', () => {
    const r = monthRangeFor('2028-02-29')
    expect(r).toEqual({ start: '2028-02-01', nextStart: '2028-03-01' })
    expect('2028-02-29' < r.nextStart).toBe(true)
  })

  it('February in a non-leap year', () => {
    expect(monthRangeFor('2027-02-15')).toEqual({ start: '2027-02-01', nextStart: '2027-03-01' })
  })

  it('December rolls over to January of the next year', () => {
    const r = monthRangeFor('2026-12-31')
    expect(r).toEqual({ start: '2026-12-01', nextStart: '2027-01-01' })
    expect('2027-01-05' < r.nextStart).toBe(false)
  })

  it('the 1st is its own month start', () => {
    expect(monthRangeFor('2026-03-01')).toEqual({ start: '2026-03-01', nextStart: '2026-04-01' })
  })
})

// HeroStats is a .tsx server component (no JSX transform in vitest) — source pins.
describe('neighbourhood HeroStats event counts', () => {
  const src = read('app/neighborhoods/[slug]/HeroStats.tsx')

  it('counts only public, held events — no drafts/pending/flagged, no cancelled or postponed', () => {
    expect(src).toContain("const HELD_EVENT_STATUSES = ['published', 'archived']")
  })

  it('"this month" is bounded on both ends by the city month', () => {
    expect(src).toContain('const month    = monthRangeFor(today)')
    expect(src).toContain('prisma.event.count({ where: { neighborhood: name, cityId, status: { in: HELD_EVENT_STATUSES }, date: { gte: month.start, lt: month.nextStart } } })')
    expect(src).not.toMatch(/date: \{ gte: monthStr \}/)
  })

  it('"past events" filters on status too', () => {
    expect(src).toContain('prisma.event.count({ where: { neighborhood: name, cityId, status: { in: HELD_EVENT_STATUSES }, date: { lt: today } } })')
  })

  it('no event count in the file is left without a status filter', () => {
    const counts = src.match(/prisma\.event\.count\(\{ where: \{[^}]*\}[^)]*\)/g) ?? []
    expect(counts).toHaveLength(2)
    for (const c of counts) expect(c).toContain('status: { in: HELD_EVENT_STATUSES }')
  })
})

describe('neighbourhood page siblings', () => {
  const sections = read('app/neighborhoods/[slug]/NeighborhoodSections.tsx')
  const index    = read('app/neighborhoods/page.tsx')

  it('uses the city\'s day, not server UTC', () => {
    expect(sections).toContain('const today = todayInTz(city.timezone)')
    expect(sections).not.toContain("new Date().toISOString().split('T')[0]")
  })

  it('drops the unrendered, unfiltered past-event count', () => {
    expect(sections).not.toMatch(/prisma\.event\.count\(/)
  })

  it('"events hosted in X" counts held events only', () => {
    expect(sections).toMatch(/by:\s*\['hostId'\],\s*\/\/[^\n]*\n\s*where:\s*\{ neighborhood: name, cityId, status: \{ in: HELD_EVENT_STATUSES \} \}/)
  })

  it('"N upcoming" on nearby cards and on the index counts published events only', () => {
    expect(sections).toMatch(/where: \{ cityId, date: \{ gte: today \}, status: 'published' \}/)
    expect(index).toMatch(/by: \['neighborhood'\],\s*(\/\/[^\n]*\n\s*)*where: \{ cityId, date: \{ gte: today \}, status: 'published' \}/)
  })

  it('community photos only come from publicly visible events', () => {
    expect(sections).toContain('where:   { event: { neighborhood: name, cityId, status: { in: [...PUBLIC_EVENT_STATUSES] } } }')
  })

  it('"clubs active here" counts held events, on the city calendar', () => {
    expect(sections).toMatch(/clubId: \{ not: null \},\s*status: \{ in: HELD_EVENT_STATUSES \},\s*date: \{ gte: shiftDay\(today, -30\) \}/)
  })
})
