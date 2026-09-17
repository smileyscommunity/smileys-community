import { describe, it, expect } from 'vitest'
import { checkInNudges, type NudgeEvent } from '@/lib/checkInNudge'

// The start-time "check-in is open" ping to the people running the door. The
// hourly reminders sweep sends it; these pin who gets it and when.

const at = (hhmm: string) => new Date(`2026-09-15T${hhmm}:00Z`)
const startsAtOf = (e: NudgeEvent) => at(e.time)

const ev = (over: Partial<NudgeEvent> = {}): NudgeEvent => ({
  id: 'e1', title: 'Sunset Sailing', time: '19:00', status: 'published', cancelledAt: null,
  hostId: 'h', cohosts: [{ userId: 'c' }],
  attendees: [
    { userId: 'h',  checkedIn: false },
    { userId: 'a1', checkedIn: false },
    { userId: 'a2', checkedIn: false },
  ],
  ...over,
})

describe('checkInNudges', () => {
  it('pings the host and co-hosts running that event', () => {
    const [n] = checkInNudges([ev()], at('19:00'), startsAtOf)
    expect(n.userIds).toEqual(['h', 'c'])
    expect(n.eventId).toBe('e1')
    // The room is the guests, not the host who RSVP'd to their own event.
    expect(n.body).toContain('2 people are confirmed')
  })

  it('every start falls in exactly one hourly run', () => {
    const runs = ['17:00', '18:00', '19:00', '20:00', '21:00'].map(h => new Date(at(h).getTime() + 5_000))
    for (const time of ['19:00', '19:15', '19:29', '19:30', '19:45', '19:59']) {
      const hits = runs.filter(r => checkInNudges([ev({ time })], r, startsAtOf).length === 1)
      expect(hits, time).toHaveLength(1)
    }
  })

  it('never pings an event that is not going ahead', () => {
    expect(checkInNudges([ev({ status: 'cancelled' })], at('19:00'), startsAtOf)).toEqual([])
    expect(checkInNudges([ev({ status: 'draft' })], at('19:00'), startsAtOf)).toEqual([])
    expect(checkInNudges([ev({ cancelledAt: at('10:00') })], at('19:00'), startsAtOf)).toEqual([])
  })

  it('skips a TBA start rather than pinging at midnight', () => {
    expect(checkInNudges([ev({ time: 'TBA' })], at('00:00'), () => at('00:00'))).toEqual([])
  })

  it('skips a room with nobody but the people running it', () => {
    expect(checkInNudges([ev({ attendees: [{ userId: 'h', checkedIn: false }, { userId: 'c', checkedIn: false }] })], at('19:00'), startsAtOf)).toEqual([])
  })

  it('skips a door that is already half scanned', () => {
    const scanned = ev({ attendees: [{ userId: 'a1', checkedIn: true }, { userId: 'a2', checkedIn: false }] })
    expect(checkInNudges([scanned], at('19:00'), startsAtOf)).toEqual([])
  })

  it('pings a host listed as their own co-host once', () => {
    // The club's hosts run the door too; an inactive club's don't.
    const [withClub] = checkInNudges([ev({ club: { isActive: true, memberships: [{ userId: 'k' }] } })], at('19:00'), startsAtOf)
    expect(withClub.userIds).toEqual(['h', 'c', 'k'])
    const [inactive] = checkInNudges([ev({ club: { isActive: false, memberships: [{ userId: 'k' }] } })], at('19:00'), startsAtOf)
    expect(inactive.userIds).toEqual(['h', 'c'])
    const [n] = checkInNudges([ev({ cohosts: [{ userId: 'h' }] })], at('19:00'), startsAtOf)
    expect(n.userIds).toEqual(['h'])
  })
})
