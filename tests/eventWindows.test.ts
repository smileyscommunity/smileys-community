import { describe, it, expect } from 'vitest'
import { windowRange, inWindow, isEventWindow, windowDates } from '@/lib/eventWindows'

// 2026-10-02 is a Friday; Fri 2 – Sun 4 Oct is "the weekend"; week ends Sun 4.
describe('windowRange', () => {
  it('today is one day', () => expect(windowRange('today', '2026-10-02')).toEqual({ start: '2026-10-02', end: '2026-10-02' }))
  it('this week runs from today to Sunday', () => expect(windowRange('this-week', '2026-10-02')).toEqual({ start: '2026-10-02', end: '2026-10-04' }))
  it('on Monday the week is the whole week', () => expect(windowRange('this-week', '2026-10-05')).toEqual({ start: '2026-10-05', end: '2026-10-11' }))
  it('midweek the weekend is the coming Fri–Sun', () => expect(windowRange('this-weekend', '2026-10-07')).toEqual({ start: '2026-10-09', end: '2026-10-11' }))
  it('on Friday it starts today', () => expect(windowRange('this-weekend', '2026-10-02')).toEqual({ start: '2026-10-02', end: '2026-10-04' }))
  it('on Saturday it is today and Sunday', () => expect(windowRange('this-weekend', '2026-10-03')).toEqual({ start: '2026-10-03', end: '2026-10-04' }))
  it('on Sunday it is just today — earlier days are never listed', () => expect(windowRange('this-weekend', '2026-10-04')).toEqual({ start: '2026-10-04', end: '2026-10-04' }))
})

describe('inWindow', () => {
  const ev = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map(date => ({ date }))
  it('keeps only events inside the inclusive range', () => {
    expect(inWindow(ev, 'this-weekend', '2026-10-02').map(e => e.date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04'])
    expect(inWindow(ev, 'today', '2026-10-02').map(e => e.date)).toEqual(['2026-10-02'])
  })
})

describe('helpers', () => {
  it('validates window slugs', () => {
    expect(isEventWindow('this-weekend')).toBe(true)
    expect(isEventWindow('next-year')).toBe(false)
  })
  it('formats a range or a single day', () => {
    expect(windowDates('this-weekend', '2026-10-02')).toContain('–')
    expect(windowDates('today', '2026-10-02')).not.toContain('–')
  })
})
