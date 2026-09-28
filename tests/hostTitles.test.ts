import { describe, it, expect } from 'vitest'
import { HOST_TITLE, HOST_PATH, rankHosts, projectRosterForViewer, hostActivityLine, type RosterHost } from '@/lib/hostTitles'

// Visible titles for volunteer hosts: two public nouns (docs/city-lead-rename),
// a stated path between them, and one guest rule for every roster surface.

const host = (over: Partial<RosterHost>): RosterHost => ({
  id: 'u1', name: 'Ayşe Yılmaz', color: '#000', profilePhoto: '/p.jpg', title: 'host',
  clubs: [], upcomingCount: 0, hostedCount: 0, ...over,
})

describe('vocabulary', () => {
  it('is exactly the two decided nouns, in climbing order', () => {
    expect(HOST_TITLE).toEqual({ lead: 'City Lead', host: 'Host' })
    expect(HOST_PATH.map(s => s.title)).toEqual(['host', 'lead'])
    expect(HOST_PATH.map(s => s.label)).toEqual(['Host', 'City Lead'])
  })
})

describe('rankHosts', () => {
  it('puts City Leads first, then hosts with something to join, then track record, then name', () => {
    const rows = [
      host({ id: 'a', name: 'Zed', title: 'host', upcomingCount: 3 }),
      host({ id: 'b', name: 'Amy', title: 'host', hostedCount: 40 }),
      host({ id: 'c', name: 'Bob', title: 'host', hostedCount: 40 }),
      host({ id: 'd', name: 'Lead', title: 'lead' }),
    ].sort(rankHosts)
    expect(rows.map(r => r.id)).toEqual(['d', 'a', 'b', 'c'])
  })
})

describe('projectRosterForViewer', () => {
  const roster = [host({ id: 'u1', name: 'Ayşe Yılmaz' }), host({ id: 'u2', name: 'Nate G.', title: 'lead' })]
  it('leaves a member\'s view untouched', () => {
    expect(projectRosterForViewer(roster, true)).toEqual(roster)
  })
  it('gives a guest a first name, no photo and no id to follow, and keeps the title', () => {
    const guest = projectRosterForViewer(roster, false)
    expect(guest.map(h => h.name)).toEqual(['Ayşe', 'Nate'])
    expect(guest.every(h => h.id === '')).toBe(true)
    expect(guest.every(h => h.profilePhoto === null)).toBe(true)
    expect(guest[1].title).toBe('lead')
  })
  it('never lets a guest see an empty name', () => {
    expect(projectRosterForViewer([host({ name: '' })], false)[0].name).toBe('')
    expect(projectRosterForViewer([host({ name: '🙂' })], false)[0].name).toBe('🙂')
  })
})

describe('hostActivityLine', () => {
  it('prefers something to join, then a track record, then the title itself', () => {
    expect(hostActivityLine({ title: 'host', upcomingCount: 2, hostedCount: 9 })).toBe('2 upcoming events')
    expect(hostActivityLine({ title: 'host', upcomingCount: 0, hostedCount: 1 })).toBe('1 event hosted')
    // 2026-09-28: the chip already says the title; the line says what they do.
    expect(hostActivityLine({ title: 'lead', upcomingCount: 0, hostedCount: 0 })).toBe('Leads the city')
    expect(hostActivityLine({ title: 'host', upcomingCount: 0, hostedCount: 0 })).toBe('Runs a club')
  })
})
