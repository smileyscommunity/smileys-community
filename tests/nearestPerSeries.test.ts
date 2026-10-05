import { describe, it, expect } from 'vitest'
import { nearestPerSeries } from '@/lib/eventSeries'

const ev = (id: string, date: string, seriesId: string | null = null, time: string | null = null) => ({ id, date, time, seriesId })

describe('nearestPerSeries', () => {
  it('keeps only the soonest date of a weekly series', () => {
    const rows = [ev('c', '2026-10-28', 's'), ev('a', '2026-10-14', 's'), ev('b', '2026-10-21', 's'), ev('d', '2026-11-04', 's')]
    expect(nearestPerSeries(rows).map(e => e.id)).toEqual(['a'])
  })

  it('leaves one-off events alone and keeps the input order', () => {
    const rows = [ev('x', '2026-10-30'), ev('b', '2026-10-21', 's'), ev('y', '2026-10-12'), ev('a', '2026-10-14', 's')]
    expect(nearestPerSeries(rows).map(e => e.id)).toEqual(['x', 'y', 'a'])
  })

  it('handles several series independently', () => {
    const rows = [ev('s1b', '2026-10-21', 's1'), ev('s2a', '2026-10-15', 's2'), ev('s1a', '2026-10-14', 's1'), ev('s2b', '2026-10-22', 's2')]
    expect(nearestPerSeries(rows).map(e => e.id).sort()).toEqual(['s1a', 's2a'])
  })

  it('breaks a same-day tie on start time', () => {
    const rows = [ev('late', '2026-10-14', 's', '21:00'), ev('early', '2026-10-14', 's', '19:00')]
    expect(nearestPerSeries(rows).map(e => e.id)).toEqual(['early'])
  })

  it('returns an empty list unchanged', () => {
    expect(nearestPerSeries([])).toEqual([])
  })
})
