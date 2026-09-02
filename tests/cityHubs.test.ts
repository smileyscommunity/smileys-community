import { describe, it, expect } from 'vitest'
import { hubCanonical, publicLinkFor, isDefaultCitySlug, enterLinkFor } from '@/app/[city]/data'
import { DEFAULT_CITY_SLUG } from '@/lib/cities'

// The per-city hubs exist for crawlers, which carry no cookie and used to see
// only the default city's lists. Two rules keep that honest without moving
// URLs Google already ranks: the default city's canonical stays /events and
// /clubs, every other city's is its own hub; and a guest on a city page is
// sent to the crawlable hub while a member keeps the cookie-setting entry.

describe('hubCanonical', () => {
  it('keeps the default city on the global URLs and gives every other city its hub', () => {
    expect(hubCanonical(DEFAULT_CITY_SLUG, 'events')).toMatch(/\/app\/events$/)
    expect(hubCanonical(DEFAULT_CITY_SLUG, 'clubs')).toMatch(/\/app\/clubs$/)
    expect(hubCanonical('izmir', 'events')).toMatch(/\/app\/izmir\/events$/)
    expect(hubCanonical('izmir', 'clubs')).toMatch(/\/app\/izmir\/clubs$/)
    expect(hubCanonical('izmir', 'directory')).toMatch(/\/app\/izmir\/directory$/)
    expect(hubCanonical(DEFAULT_CITY_SLUG, 'board')).toMatch(/\/app\/board$/)
    expect(isDefaultCitySlug(DEFAULT_CITY_SLUG)).toBe(true)
    expect(isDefaultCitySlug('izmir')).toBe(false)
  })
})

describe('publicLinkFor', () => {
  const enter = enterLinkFor('izmir')
  const guest = publicLinkFor('izmir', enter)
  it('sends a guest to the hub for events, clubs, directory and board', () => {
    expect(guest('events')).toBe('/app/izmir/events')
    expect(guest('clubs')).toBe('/app/izmir/clubs')
    expect(guest('directory')).toBe('/app/izmir/directory')
    expect(guest('board')).toBe('/app/izmir/board')
  })
  it('leaves every other destination on the cookie-setting entry link', () => {
    expect(guest('guide')).toBe(enter('guide'))
    expect(guest('neighborhoods', 'alsancak')).toBe(enter('neighborhoods', 'alsancak'))
    expect(enter('neighborhoods', 'alsancak')).toBe('/app/api/city/enter?city=izmir&to=neighborhoods&n=alsancak')
  })
  it('the default city has no separate hub: guests go to the global lists', () => {
    const d = publicLinkFor(DEFAULT_CITY_SLUG, enterLinkFor(DEFAULT_CITY_SLUG))
    expect(d('events')).toBe('/app/events')
    expect(d('clubs')).toBe('/app/clubs')
  })
})
