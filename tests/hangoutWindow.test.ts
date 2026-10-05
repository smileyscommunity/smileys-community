import { describe, it, expect } from 'vitest'
import { formatHangoutWindow, hangoutUntilLabel, hangoutDayLabel } from '@/lib/hangoutTime'

// Istanbul is UTC+3 year-round; 2026-10-05 is a Monday.
const TZ = 'Europe/Istanbul'
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+03:00`).toISOString()
const NOW = new Date('2026-10-05T08:00:00+03:00')

describe('hangout window label', () => {
  it('a multi-day hangout names both dates, not "Today … (next day)"', () => {
    const label = formatHangoutWindow(at('2026-10-05', '09:00'), at('2026-10-08', '20:00'), TZ, NOW)
    expect(label).toBe('Mon Oct 5 – Thu Oct 8 · 09:00–20:00')
    expect(label).not.toContain('Today')
    expect(label).not.toContain('next day')
  })

  it('an overnight hangout also names both days', () => {
    expect(formatHangoutWindow(at('2026-10-05', '23:00'), at('2026-10-06', '01:00'), TZ, NOW))
      .toBe('Mon Oct 5 – Tue Oct 6 · 23:00–01:00')
  })

  it('a same-day hangout keeps the Today / Now / In Nm prefixes', () => {
    expect(formatHangoutWindow(at('2026-10-05', '19:00'), at('2026-10-05', '21:00'), TZ, NOW)).toBe('Today · 19:00–21:00')
    expect(formatHangoutWindow(at('2026-10-05', '08:30'), at('2026-10-05', '10:00'), TZ, NOW)).toBe('In 30m · 08:30–10:00')
    expect(formatHangoutWindow(at('2026-10-05', '07:00'), at('2026-10-05', '10:00'), TZ, NOW)).toBe('Now · 07:00–10:00')
    expect(formatHangoutWindow(at('2026-10-07', '18:00'), at('2026-10-07', '20:00'), TZ, NOW)).toBe('Wed Oct 7 · 18:00–20:00')
  })

  it('days are the city\'s, not the device\'s', () => {
    // 22:30 UTC on Oct 5 is already Oct 6 01:30 in Istanbul.
    expect(hangoutDayLabel(new Date('2026-10-05T22:30:00Z'), TZ)).toBe('Tue Oct 6')
  })

  it('"until" adds the date only when the end is not today', () => {
    expect(hangoutUntilLabel(new Date(at('2026-10-05', '20:00')), TZ, NOW)).toBe('until 20:00')
    expect(hangoutUntilLabel(new Date(at('2026-10-08', '20:00')), TZ, NOW)).toBe('until Thu Oct 8, 20:00')
  })
})
