import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tripArrivalRecipients, tripArrivalMessage } from '../lib/notify'

// Cross-city trips, phase 2: a trip tells the city it visits.
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('trip arrival announcement', () => {
  it('goes to the destination\'s people, not the host or the club (they heard via the club)', () => {
    expect(tripArrivalRecipients(['l1', 'l2', 'host', 'club1', 'l1'], ['club1'], 'host')).toEqual(['l1', 'l2'])
    expect(tripArrivalRecipients([], ['club1'], null)).toEqual([])
  })
  it('says who is coming, where, and when — the date cannot drift with the server zone', () => {
    expect(tripArrivalMessage('Istanbul', 'Eskişehir', 'Day trip by train', '2026-10-12')).toEqual({
      title: 'Members from Istanbul are coming to Eskişehir 🚆',
      body:  '"Day trip by train" on 12 Oct — come and meet them.',
    })
    expect(tripArrivalMessage('A', 'B', 'T', '2026-01-01').body).toContain('on 1 Jan')
  })
  it('reads the right people, once per trip, as a new_event (mute + quiet hours respected)', () => {
    const notify = read('lib/notify.ts')
    expect(notify).toContain('if (!event.originCityId || event.originCityId === event.cityId) return')
    expect(notify).toContain('rateLimit(`trip-arrival-announce:${event.id}`, 1,')
    expect(notify).toContain("{ cityRelationships: { some: { cityId: event.cityId, type: 'member' } } },")
    expect(notify).toContain("createNotification(id, 'new_event', title, body, link)")
  })
  it('fires wherever a new-event announcement does: create, edit-to-published, approval', () => {
    expect(read('app/api/admin/events/route.ts')).toContain('notifyTripArrival({ id: event.id, title: cleanTitle, date, cityId: placeCityId, originCityId, clubId, hostId })')
    const edit = read('app/api/admin/events/[id]/route.ts')
    expect(edit.match(/notifyTripArrival\(\{ id, title: (event|before)\.title, date: (event|before)\.date, cityId: before\.cityId, originCityId: before\.originCityId/g)).toHaveLength(2)
  })
})
