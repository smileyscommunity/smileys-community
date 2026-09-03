import { describe, it, expect } from 'vitest'
import { eventListJsonLd, eventStartDate, offsetInTz, MAX_LISTED } from '@/lib/eventJsonLd'

// Event pages have carried Event JSON-LD for a long time; no LISTING did, so
// Google had every event and no event list. These are the rules the listings
// now emit.

const city = { name: 'Istanbul', country: 'Turkey', timezone: 'Europe/Istanbul' }
const urls = { appUrl: 'https://x.test/app', siteUrl: 'https://x.test' }
const ev = (o: Partial<Parameters<typeof eventListJsonLd>[0][number]> = {}) => ({
  id: 'e1', title: 'Bosphorus Walk', emoji: '🚶', date: '2026-09-10', time: '19:30', ...o,
})

describe('offsetInTz', () => {
  it('reads the offset from the zone, not from a pinned literal', () => {
    // The whole point: Türkiye is +03:00 year round, so a hardcoded offset
    // looks correct until a city outside it goes live. These must differ.
    const summer = new Date('2026-07-01T12:00:00Z')
    expect(offsetInTz(summer, 'Europe/Istanbul')).toBe('+03:00')
    expect(offsetInTz(summer, 'Europe/Lisbon')).toBe('+01:00')
    expect(offsetInTz(summer, 'Asia/Dubai')).toBe('+04:00')
  })

  it('follows DST for zones that observe it', () => {
    expect(offsetInTz(new Date('2026-01-15T12:00:00Z'), 'Europe/Berlin')).toBe('+01:00')
    expect(offsetInTz(new Date('2026-07-15T12:00:00Z'), 'Europe/Berlin')).toBe('+02:00')
  })

  it('never throws the page down on a bad zone', () => {
    expect(offsetInTz(new Date(), 'Not/AZone')).toBe('Z')
  })
})

describe('eventStartDate', () => {
  it('combines date and time with the city offset', () => {
    expect(eventStartDate(ev(), 'Europe/Istanbul')).toBe('2026-09-10T19:30:00+03:00')
  })

  it('falls back to a date-only startDate rather than inventing an hour', () => {
    // 'TBA' is a real value in this column; midnight would advertise a
    // time the host never set.
    for (const time of ['TBA', '', null, undefined, 'evening', '25:00']) {
      expect(eventStartDate(ev({ time }), 'Europe/Istanbul')).toBe('2026-09-10')
    }
  })
})

describe('eventListJsonLd', () => {
  it('stays quiet rather than claiming a page has no events', () => {
    expect(eventListJsonLd([], city, urls)).toBeNull()
  })

  it('emits one positioned ListItem per event', () => {
    const list = eventListJsonLd([ev(), ev({ id: 'e2', title: 'Kadıköy Dinner' })], city, urls)!
    expect(list['@type']).toBe('ItemList')
    expect(list.itemListElement).toHaveLength(2)
    expect(list.itemListElement.map(i => i.position)).toEqual([1, 2])
    const first = list.itemListElement[0].item
    expect(first).toMatchObject({
      '@type':   'Event',
      name:      'Bosphorus Walk',
      startDate: '2026-09-10T19:30:00+03:00',
      url:       'https://x.test/app/events/e1',
    })
    expect(first.location.address).toMatchObject({ addressLocality: 'Istanbul', addressCountry: 'Turkey' })
  })

  it('strips HTML out of a description and caps its length', () => {
    const long = '<p>' + 'a'.repeat(900) + '</p>'
    const item = eventListJsonLd([ev({ description: long })], city, urls)!.itemListElement[0].item
    expect(item.description).not.toContain('<')
    expect(item.description.length).toBeLessThanOrEqual(500)
  })

  it('omits image entirely rather than emitting an empty one', () => {
    const item = eventListJsonLd([ev({ coverImage: null })], city, urls)!.itemListElement[0].item
    expect('image' in item).toBe(false)
  })

  it('caps how many events it lists', () => {
    const many = Array.from({ length: 50 }, (_, i) => ev({ id: `e${i}` }))
    expect(eventListJsonLd(many, city, urls)!.itemListElement).toHaveLength(MAX_LISTED)
  })

  it('uses the listed city, not a pinned Istanbul', () => {
    const izmir = { name: 'İzmir', country: 'Turkey', timezone: 'Europe/Istanbul' }
    const item  = eventListJsonLd([ev()], izmir, urls)!.itemListElement[0].item
    expect(item.location.address.addressLocality).toBe('İzmir')
    expect(item.description).toContain('İzmir')
  })
})

// The /events layout wraps /events/[id] as well, so it gates on the path.
// This is that rule, extracted — a detail page must keep its own Event as the
// page's primary entity rather than carrying a list of twenty other events.
const isListing = (path: string) => path.split('?')[0].replace(/\/$/, '').endsWith('/events')

describe('which routes carry the list', () => {
  it('emits on the listing, including the city hubs', () => {
    for (const p of ['/app/events', '/app/events/', '/app/events?tab=all', '/app/izmir/events']) {
      expect(isListing(p)).toBe(true)
    }
  })

  it('stays off event detail pages', () => {
    for (const p of ['/app/events/cmt123', '/app/events/cmt123?from=home', '/app/events/cmt123/participants']) {
      expect(isListing(p)).toBe(false)
    }
  })
})
