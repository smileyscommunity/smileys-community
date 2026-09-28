import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Landing page scan 2026-09-29, items 1–5: event lists ship card fields only
// and never the admission rules; only live cities' events, each city's next
// few included; quotes only from listable authors; the hero's alt text is
// the admin's; one three-group city story; the events block says who can
// walk in.

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { toEventCard } from '@/lib/eventCard'
import { redactEventForGuest } from '@/lib/db'
import { testimonialAuthorOk, publicTestimonial } from '@/lib/testimonialQuery'
import type { Event } from '@/lib/data'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const landing = read('app/page.tsx')

const full = {
  id: 'e1', title: 'Photowalk', date: '2026-10-01', time: '10:00', status: 'published', emoji: '📷',
  neighborhood: 'Balat', location: 'Fener ferry pier', description: 'Call me on +90 531 000 0000',
  hostId: 'h1', hostName: 'Leyla', hostColor: '#000', hostPhoto: null, membersOnly: true, isPremium: false,
  price: 0, currency: 'TRY', limitedSpots: true, totalSpots: 20, spotsLeft: 5, vibes: [], tags: ['x'],
  genderBalance: true, maleQuota: 10, femaleQuota: 10, turkishMaleQuota: 5, tierOverride: 'open', cancelCutoffHours: 12,
  address: 'Street 1', lat: 41, lng: 29, whatsappUrl: 'https://wa', meetingUrl: 'https://meet', paymentContact: 'iban',
  clubId: 'c1', clubName: 'Photo Club', attendeePreviews: [],
} as unknown as Event

describe('item 1: event cards carry card fields only', () => {
  it('toEventCard drops the description, venue, quotas, links and ids', () => {
    const c = toEventCard({ ...full, cityName: 'Istanbul', timeZone: 'Europe/Istanbul' }) as unknown as Record<string, unknown>
    expect(c).toMatchObject({ id: 'e1', title: 'Photowalk', neighborhood: 'Balat', membersOnly: true, genderBalance: true, cityName: 'Istanbul' })
    for (const k of ['maleQuota', 'femaleQuota', 'turkishMaleQuota', 'tierOverride', 'cancelCutoffHours', 'address', 'lat', 'whatsappUrl', 'meetingUrl', 'paymentContact']) {
      expect(c[k], k).toBeUndefined()
    }
    expect(c.description).toBe('')
    expect(c.location).toBe('')
    expect(c.hostId).toBe('')
    expect(JSON.stringify(c)).not.toContain('+90')
  })
  it('guests never get the admission rules from any list', () => {
    const g = redactEventForGuest(full) as unknown as Record<string, unknown>
    for (const k of ['maleQuota', 'femaleQuota', 'turkishMaleQuota', 'tierOverride', 'cancelCutoffHours']) expect(g[k], k).toBeNull()
    expect(g.genderBalance).toBe(true)
  })
  it('members get them only for events they host or co-host', () => {
    const db = read('lib/db.ts')
    expect(db).toContain('const hosting = orig.hostId === viewer.id || cohostOf.has(orig.id)')
    expect(db).toContain('if (inside.has(orig.id)) return { ...e, ...ADMISSION_HIDDEN }')
  })
  it('the landing and the city page pass their lists through it', () => {
    expect(landing).toContain('const events = rawEvents.map(e => toEventCard({ ...redactEventForGuest(e),')
    expect(read('app/[city]/page.tsx')).toContain('const tabEvents = arrangeEvents(events).map(toEventCard)')
    expect(landing).toContain("['global-landing-data-v2']")
  })
})

describe('item 2: only live cities, every live city represented; listable quote authors', () => {
  it('the landing asks for live cities and each city\'s next three', () => {
    expect(landing).toContain('getEvents({ limit: 60, upcoming: true, cityIds: liveIds })')
    expect(landing).toContain('Promise.all(liveIds.map(cityId => getEvents({ limit: 3, upcoming: true, cityId }).then(r => r.events)))')
    expect(read('lib/db.ts')).toContain('...(cityId ? { cityId } : cityIds ? { cityId: { in: cityIds } } : {}),')
  })
  it('quotes from banned, suspended or hidden authors are dropped; a connections-only author keeps the quote, not the face', () => {
    const w = testimonialAuthorOk() as unknown as { OR: [unknown, { user: Record<string, unknown> }] }
    expect(w.OR[0]).toEqual({ userId: null })
    expect(w.OR[1].user).toMatchObject({ status: 'approved', hiddenFromMembers: false })
    expect(publicTestimonial({ id: 't', photo: 'p.jpg', user: { profileVisibility: 'connections' } })).toEqual({ id: 't', photo: null })
    expect(publicTestimonial({ id: 't', photo: 'p.jpg', user: null })).toEqual({ id: 't', photo: 'p.jpg' })
    expect(landing).toContain("where:   { active: true, ...testimonialAuthorOk() },")
    expect(read('app/[city]/data.ts')).toContain('AND: [{ OR: [{ cityId }, { cityId: null }] }, testimonialAuthorOk()]')
  })
})

describe('item 3: the hero alt is the admin\'s', () => {
  it('an admin field, saved trimmed, used for the page and the share card', () => {
    expect(read('app/api/admin/content/route.ts')).toContain('heroAlt:   str(r.heroAlt, 200).trim(),')
    expect(read('app/admin/content/page.tsx')).toContain('Describe the photo (alt text)')
    expect(landing).toContain("return home.heroAlt?.trim() || (home.heroImage ? '' : HERO_FALLBACK_ALT)")
    expect(landing).toContain('const heroAlt   = heroAltFor(home)')
    expect(landing).not.toContain("'Smileys members together at a community dinner'")
  })
})

describe('item 4: one city story', () => {
  it('live, founding and coming soon — in the pill, the grid and the network list', () => {
    expect(landing).toContain('const liveCities  = mature.length > 0 ? mature : (fallback ? [fallback] : [])')
    expect(landing).toContain("founding.length   > 0 ? `${founding.length} founding` : ''")
    expect(landing).toContain('Founding now')
    expect(landing).toContain('Coming soon')
    expect(landing).not.toContain('more on the way')
    expect(landing).toContain("const stage = liveCities.includes(c) ? 'live' : founding.includes(c) ? 'founding' : 'soon'")
  })
  it('a forming city is badged Founding too', () => {
    expect(read('components/CityCard.tsx')).toContain('const founding = isLive && !!city.stats && city.stats.maturity !== CITY_MATURITY.SelfSustaining')
  })
})

describe('item 5: the events block says who can walk in', () => {
  it('members-only rows get the members line', () => {
    expect(landing).toContain("{anyMembersOnly ? 'Real plans, real people — members walk into any of them.' : 'Real plans, real people — walk into any of them.'}")
    expect(landing).not.toContain('A city filter joins these tabs once a second city is live')
  })
})
