import { describe, it, expect } from 'vitest'
import { groupBySeries, seriesCadenceLabel, type SeriesGroupable } from '../lib/eventSeries'

const ev = (id: string, date: string, time = '19:00', seriesId?: string): SeriesGroupable =>
  ({ id, title: id, date, time, seriesId })

describe('groupBySeries', () => {
  it('collapses a series to its next occurrence and keeps the rest', () => {
    const groups = groupBySeries([
      ev('picnic-3', '2026-08-22', '15:00', 's1'),
      ev('picnic-1', '2026-08-08', '15:00', 's1'),
      ev('picnic-2', '2026-08-15', '15:00', 's1'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].next.id).toBe('picnic-1')
    expect(groups[0].upcoming.map(e => e.id)).toEqual(['picnic-2', 'picnic-3'])
    expect(groups[0].seriesCount).toBe(3)
    expect(groups[0].isSeries).toBe(true)
  })

  it('passes standalone events through untouched', () => {
    const groups = groupBySeries([ev('one-off', '2026-08-10')])
    expect(groups).toHaveLength(1)
    expect(groups[0].isSeries).toBe(false)
    expect(groups[0].upcoming).toEqual([])
  })

  it('orders groups by their next occurrence, not by series size', () => {
    const groups = groupBySeries([
      ev('big-1', '2026-08-20', '19:00', 'big'),
      ev('big-2', '2026-08-27', '19:00', 'big'),
      ev('big-3', '2026-09-03', '19:00', 'big'),
      ev('soon', '2026-08-09'),
    ])
    expect(groups.map(g => g.next.id)).toEqual(['soon', 'big-1'])
  })

  it('breaks same-day ties by start time', () => {
    const groups = groupBySeries([ev('evening', '2026-08-10', '20:00'), ev('morning', '2026-08-10', '09:00')])
    expect(groups.map(g => g.next.id)).toEqual(['morning', 'evening'])
  })

  it('treats a series with one remaining date as not-a-series', () => {
    const groups = groupBySeries([ev('last', '2026-08-10', '19:00', 's1')])
    expect(groups[0].isSeries).toBe(false)
    expect(seriesCadenceLabel(groups[0])).toBeNull()
  })
})

describe('seriesCadenceLabel', () => {
  it('names the weekday when the series is consistent', () => {
    // 2026-08-12, 08-19, 08-26 are all Wednesdays.
    const [group] = groupBySeries([
      ev('w1', '2026-08-12', '19:00', 's'),
      ev('w2', '2026-08-19', '19:00', 's'),
      ev('w3', '2026-08-26', '19:00', 's'),
    ])
    expect(seriesCadenceLabel(group)).toBe('Every Wednesday')
  })

  it('falls back to a count when dates are irregular', () => {
    const [group] = groupBySeries([
      ev('a', '2026-08-12', '19:00', 's'),
      ev('b', '2026-08-15', '19:00', 's'),
    ])
    expect(seriesCadenceLabel(group)).toBe('2 upcoming dates')
  })
})
