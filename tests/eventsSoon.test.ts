import { describe, it, expect } from 'vitest'
import { eventsSoon, EVENTS_SOON_MAX, type SoonEvent } from '@/lib/eventsSoon'

const TZ = 'Europe/Istanbul'
const today = '2026-10-05'
const now = new Date('2026-10-05T12:00:00Z').getTime() // 15:00 Istanbul
const ev = (id: string, date: string, time: string | null, over: Partial<SoonEvent> = {}): SoonEvent => ({
  id, title: `T-${id}`, emoji: '🎉', date, time, endTime: null, neighborhood: 'Kadıköy',
  soldOut: false, limitedSpots: false, spotsLeft: 0, ...over,
})
const run = (events: SoonEvent[], over: Record<string, unknown> = {}) =>
  eventsSoon(events, { today, tz: TZ, now, joined: new Set(), pending: new Set(), ...over } as any)

describe('eventsSoon', () => {
  it('keeps today and tomorrow only, soonest first', () => {
    const out = run([ev('late', '2026-10-06', '10:00'), ev('x', '2026-10-08', '10:00'), ev('soon', today, '19:00')])
    expect(out.map(e => [e.id, e.day])).toEqual([['soon', 'Today'], ['late', 'Tomorrow']])
  })

  it('drops events that are over, sold out or full', () => {
    const out = run([
      ev('over', today, '09:00', { endTime: '11:00' }),
      ev('sold', today, '20:00', { soldOut: true }),
      ev('full', today, '20:00', { limitedSpots: true, spotsLeft: 0 }),
      ev('ok', today, '21:00'),
    ])
    expect(out.map(e => e.id)).toEqual(['ok'])
  })

  it('leaves out events the member joined or asked to join', () => {
    const out = run([ev('mine', today, '19:00'), ev('asked', today, '20:00'), ev('open', today, '21:00')],
      { joined: new Set(['mine']), pending: new Set(['asked']) })
    expect(out.map(e => e.id)).toEqual(['open'])
  })

  it('shows seats left only when few remain', () => {
    const out = run([
      ev('few', today, '18:00', { limitedSpots: true, spotsLeft: 3 }),
      ev('many', today, '19:00', { limitedSpots: true, spotsLeft: 30 }),
      ev('open', today, '20:00'),
    ])
    expect(out.map(e => e.seatsLeft)).toEqual([3, null, null])
  })

  it('caps the list', () => {
    const many = Array.from({ length: 6 }, (_, i) => ev(`e${i}`, today, `${18 + i}:00`))
    expect(run(many)).toHaveLength(EVENTS_SOON_MAX)
  })
})
