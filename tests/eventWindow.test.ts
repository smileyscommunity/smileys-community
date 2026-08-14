import { describe, it, expect, vi, afterEach } from 'vitest'
import { istanbulEventWindow } from '@/lib/data'

// The tabs are only as good as these boundaries: get them wrong and "Weekend"
// quietly shows the wrong two days. Each case pins a real day-of-week.
function at(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

afterEach(() => vi.useRealTimers())

describe('istanbulEventWindow', () => {
  it('on a Wednesday, the week runs to Sunday and the weekend is the one ahead', () => {
    at('2026-08-12T09:00:00+03:00')            // Wednesday
    const w = istanbulEventWindow()
    expect(w.today).toBe('2026-08-12')
    expect(w.weekEnd).toBe('2026-08-16')       // Sunday
    expect(w.weekendStart).toBe('2026-08-15')  // Saturday
    expect(w.weekendEnd).toBe('2026-08-16')
  })

  it('on a Saturday, the weekend is the one in progress — not next week', () => {
    at('2026-08-15T11:00:00+03:00')            // Saturday
    const w = istanbulEventWindow()
    expect(w.weekendStart).toBe('2026-08-15')  // today, not the 22nd
    expect(w.weekendEnd).toBe('2026-08-16')
  })

  it('on a Sunday, the week ends today and the weekend is its last day', () => {
    at('2026-08-16T11:00:00+03:00')            // Sunday
    const w = istanbulEventWindow()
    expect(w.weekEnd).toBe('2026-08-16')
    expect(w.weekendStart).toBe('2026-08-16')
    expect(w.weekendEnd).toBe('2026-08-16')
  })

  it('rolls across a month boundary', () => {
    at('2026-08-27T09:00:00+03:00')            // Thursday
    const w = istanbulEventWindow()
    expect(w.weekEnd).toBe('2026-08-30')
    expect(w.weekendStart).toBe('2026-08-29')
    expect(w.weekendEnd).toBe('2026-08-30')
  })

  it('uses the Istanbul day, not the viewer\'s: 23:30 UTC is already tomorrow there', () => {
    at('2026-08-12T23:30:00Z')                 // 02:30 on the 13th in Istanbul
    expect(istanbulEventWindow().today).toBe('2026-08-13')
  })
})
