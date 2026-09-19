import { describe, it, expect, beforeEach } from 'vitest'
import { searchKey, matchesName, eventTz, awaitingCheckInPerEvent, saveRoster, readRoster } from '@/lib/hostPanel'
import { isBottomNavRoute, isHostPanelRoute } from '@/lib/bottomNav'
import type { CheckInPromptEvent } from '@/lib/checkInPrompt'

// Host panel review (2026-09): the door search, the panel's own chrome, each
// event on its own city's clock, and the roster kept on the phone.

describe('door search — Turkish-aware name matching', () => {
  it('folds case, accents and the dotted/dotless i the way people type', () => {
    expect(searchKey('Şükrü')).toBe('sukru')
    expect(searchKey('İlker')).toBe('ilker')
    expect(searchKey('ILKER')).toBe('ilker')
    expect(searchKey('Işıl')).toBe('isil')
    expect(searchKey('Çağla Öztürk')).toBe('cagla ozturk')
  })

  it('matches ascii typing against Turkish names, and the reverse', () => {
    expect(matchesName('Şükrü Yılmaz', 'sukru')).toBe(true)
    expect(matchesName('Şükrü Yılmaz', 'YILMAZ')).toBe(true)
    expect(matchesName('İlker Can', 'ilk')).toBe(true)
    expect(matchesName('Ilker Can', 'İlker')).toBe(true)
    expect(matchesName('Gül', 'gul')).toBe(true)
  })

  it('plain lowercasing is what failed: İ became i plus a combining dot', () => {
    // The old filter, for the record — no ascii query could find this name.
    expect('İlker'.toLowerCase().includes('ilker')).toBe(false)
    expect(matchesName('İlker', 'ilker')).toBe(true)
  })

  it('a blank query matches everyone; a miss is a miss', () => {
    expect(matchesName('Anyone', '')).toBe(true)
    expect(matchesName('Anyone', '   ')).toBe(true)
    expect(matchesName('Şükrü', 'ahmet')).toBe(false)
  })
})

describe('host panel routes', () => {
  it('the panel is /host and below — not /hosts, the public page', () => {
    expect(isHostPanelRoute('/host')).toBe(true)
    expect(isHostPanelRoute('/host/events')).toBe(true)
    expect(isHostPanelRoute('/host/checkin')).toBe(true)
    expect(isHostPanelRoute('/hosts')).toBe(false)
    expect(isHostPanelRoute('/hostel')).toBe(false)
    expect(isHostPanelRoute(null)).toBe(false)
  })

  it('the member bottom nav stays off the host panel (it has its own shell)', () => {
    expect(isBottomNavRoute('/host')).toBe(false)
    expect(isBottomNavRoute('/host/events')).toBe(false)
    expect(isBottomNavRoute('/host/checkin', ['istanbul'])).toBe(false)
  })

  it('Meet the Hosts keeps the bottom nav it always had', () => {
    expect(isBottomNavRoute('/hosts')).toBe(true)
  })
})

describe('each event on its own clock', () => {
  it('eventTz prefers the event timezone and falls back to the browsed city', () => {
    expect(eventTz({ timezone: 'Asia/Tbilisi' }, 'Europe/Istanbul')).toBe('Asia/Tbilisi')
    expect(eventTz({ timezone: null }, 'Europe/Istanbul')).toBe('Europe/Istanbul')
    expect(eventTz({}, 'Europe/Berlin')).toBe('Europe/Berlin')
  })

  const ev = (over: Partial<CheckInPromptEvent & { timezone: string }>): CheckInPromptEvent & { timezone?: string } => ({
    id: 'e1', title: 'Quiz', emoji: '🧠', date: '2026-09-18', time: '19:00', endTime: '21:00',
    status: 'published', price: 0, roomApproved: 10, roomCheckedIn: 0, ...over,
  })

  it('hours left run on the event city, not one zone for the list', () => {
    // 2026-09-19 10:00 UTC: Istanbul (+3) 13:00, New York (-4) 06:00.
    const now = new Date('2026-09-19T10:00:00Z')
    const [ist] = awaitingCheckInPerEvent([ev({ id: 'ist', timezone: 'Europe/Istanbul' })], 'Europe/Istanbul', now)
    const [nyc] = awaitingCheckInPerEvent([ev({ id: 'nyc', timezone: 'America/New_York' })], 'Europe/Istanbul', now)
    expect(ist.hoursLeft).toBeLessThan(nyc.hoursLeft)
    expect(nyc.hoursLeft - ist.hoursLeft).toBe(7)
  })

  it('sorts the merged list by the deadline', () => {
    const now = new Date('2026-09-19T10:00:00Z')
    const list = awaitingCheckInPerEvent([
      ev({ id: 'nyc', timezone: 'America/New_York' }),
      ev({ id: 'ist', timezone: 'Europe/Istanbul' }),
    ], 'Europe/Istanbul', now)
    expect(list.map(p => p.event.id)).toEqual(['ist', 'nyc'])
  })
})

describe('the door list saved on the phone', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    }
  })

  it('round-trips the roster without contact details', () => {
    saveRoster('e1', {
      eventName: 'Quiz', eventDate: '2026-09-19', tz: 'Europe/Istanbul',
      attendees: [{ userId: 'u1', checkedIn: false, user: { id: 'u1', name: 'Şükrü', email: 'x@y.z' } }],
    })
    const saved = readRoster<{ userId: string; user: { name: string; email?: string } }>('e1')
    expect(saved?.eventName).toBe('Quiz')
    expect(saved?.attendees[0].user.name).toBe('Şükrü')
    expect(saved?.attendees[0].user.email).toBeUndefined()
  })

  it('drops other events’ lists once they are a few days old', () => {
    const old = new Date('2026-09-10T12:00:00Z')
    saveRoster('old', { eventName: 'Old', eventDate: '2026-09-10', tz: null, attendees: [] }, old)
    saveRoster('new', { eventName: 'New', eventDate: '2026-09-19', tz: null, attendees: [] }, new Date('2026-09-19T12:00:00Z'))
    expect(readRoster('old')).toBeNull()
    expect(readRoster('new')).not.toBeNull()
  })

  it('reads nothing rather than throwing on a broken entry', () => {
    store.set('smileys_host_roster_bad', '{not json')
    expect(readRoster('bad')).toBeNull()
  })
})
