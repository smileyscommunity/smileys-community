import { describe, it, expect } from 'vitest'
import { summarizeHangoutsToday, HANGOUTS_SOON_MS, type StripHangout } from '@/lib/hangoutsToday'

const now = new Date('2026-10-05T12:00:00Z') // 15:00 in Istanbul
const at = (h: number) => new Date(now.getTime() + h * 3_600_000)
const row = (id: string, startH: number, endH: number, neighborhood: string | null = null): StripHangout =>
  ({ id, title: `T-${id}`, neighborhood, startsAt: at(startH), endsAt: at(endH) })

describe('summarizeHangoutsToday', () => {
  it('shows a hangout that has not started yet (the old strip hid it)', () => {
    const s = summarizeHangoutsToday([row('a', 4, 6, 'Kadıköy')], now, 'Europe/Istanbul')
    expect(s).toMatchObject({ live: 0, upcoming: 1, next: { id: 'a', time: '19:00', tomorrow: false, neighborhood: 'Kadıköy' } })
  })

  it('counts live ones separately and keeps the live neighborhood', () => {
    const s = summarizeHangoutsToday([row('a', -1, 2, 'Beşiktaş'), row('b', 3, 5)], now, 'Europe/Istanbul')
    expect(s).toMatchObject({ live: 1, upcoming: 1, liveHood: 'Beşiktaş', next: { id: 'b' } })
  })

  it('picks the soonest upcoming one regardless of input order', () => {
    const s = summarizeHangoutsToday([row('late', 8, 9), row('soon', 2, 3)], now, 'Europe/Istanbul')
    expect(s.next?.id).toBe('soon')
  })

  it('does not count one that has already ended', () => {
    const s = summarizeHangoutsToday([row('over', -3, -1)], now, 'Europe/Istanbul')
    expect(s).toMatchObject({ live: 0, upcoming: 0, next: null })
  })

  it('marks one that starts after the city\'s midnight as tomorrow', () => {
    const s = summarizeHangoutsToday([row('night', 10, 12)], now, 'Europe/Istanbul') // 01:00 next day
    expect(s.next).toMatchObject({ time: '01:00', tomorrow: true })
  })

  it('reads the clock in the city\'s zone, not the server\'s', () => {
    expect(summarizeHangoutsToday([row('a', 4, 6)], now, 'America/New_York').next?.time).toBe('12:00')
  })

  it('looks one day ahead', () => { expect(HANGOUTS_SOON_MS).toBe(86_400_000) })
})
