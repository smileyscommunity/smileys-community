import { describe, it, expect } from 'vitest'
import { eventPhase } from '@/lib/eventTime'

// "Let's Get Social 🎧", 2026-09-09 at 19:00 in Istanbul, showed a green
// LIVE NOW banner at 17:35. The banner's window started two hours before
// the start and called all of it live. Two phases now.
const TZ = 'Europe/Istanbul'
const ev = { date: '2026-09-09', time: '19:00', endTime: null }
const at = (hhmm: string, date = '2026-09-09') => new Date(`${date}T${hhmm}:00+03:00`)

describe('eventPhase', () => {
  it('is nothing more than two hours before the start', () => {
    expect(eventPhase(ev, TZ, at('16:59'))).toBeNull()
    expect(eventPhase(ev, TZ, at('12:00'))).toBeNull()
  })
  it('is "soon", not live, in the two hours before the doors open', () => {
    expect(eventPhase(ev, TZ, at('17:00'))).toBe('soon')
    expect(eventPhase(ev, TZ, at('17:35'))).toBe('soon')
    expect(eventPhase(ev, TZ, at('18:59'))).toBe('soon')
  })
  it('is live from the start until the end', () => {
    expect(eventPhase(ev, TZ, at('19:00'))).toBe('live')
    expect(eventPhase(ev, TZ, at('22:30'))).toBe('live')
    // No endTime → 23:59 on the day, the same end the post-event jobs use.
    expect(eventPhase(ev, TZ, at('23:58'))).toBe('live')
    expect(eventPhase(ev, TZ, at('00:10', '2026-09-10'))).toBeNull()
  })
  it('honours an explicit end, including one past midnight', () => {
    expect(eventPhase({ ...ev, endTime: '21:00' }, TZ, at('21:00'))).toBeNull()
    expect(eventPhase({ date: '2026-09-09', time: '22:00', endTime: '02:00' }, TZ, at('01:00', '2026-09-10'))).toBe('live')
  })
  it('reads the wall clock in the event city, not the server', () => {
    // 17:35 Istanbul is 14:35 UTC; a UTC reading would call this "soon" for a
    // different two hours. The instant is the same either way.
    expect(eventPhase(ev, TZ, new Date('2026-09-09T14:35:00Z'))).toBe('soon')
    expect(eventPhase(ev, TZ, new Date('2026-09-09T16:00:00Z'))).toBe('live')
  })
})
