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

// Items 6–12 (2026-09-29).

describe('item 6: landing links do not follow the view-city cookie', () => {
  it('visiting, guides, handbook and View all events are pinned', () => {
    expect(landing).toContain("href:  singleCity ? `/visiting?city=${flagship.slug}` : '/visiting',")
    expect(landing).toContain('<Link key={c.id} href={`/guide?city=${c.slug}`}')
    expect(landing).toContain("href={singleCity ? `/handbook?city=${flagship.slug}` : '/handbook'}")
    expect(landing).toContain('allHref={singleCity ? `/app/events?city=${flagship.slug}` : undefined}')
  })
})

describe('item 7: crawlable links', () => {
  const card = read('components/CityCard.tsx')
  it('live city cards link straight to the city page; coming-soon links have text', () => {
    expect(card).toContain('? <Link href={`/${city.slug}`} className="group block h-full">{body}</Link>')
    expect(card).not.toContain('/app/api/city/enter?city=${city.slug}&to=city')
    expect(card).toContain('<span className="sr-only">About {city.name}</span>')
  })
  it('arrival cards go straight to the city hub, no redirect hop', () => {
    for (const hub of ['remote-work', 'moving', 'students']) expect(landing).toContain(`\`/\${flagship.slug}/${hub}\``)
  })
})

describe('item 8: copy the product can back', () => {
  it('the visiting section speaks to a guest and names the application', () => {
    expect(landing).toContain('Join Smileys — a short application, reviewed by hand.')
    expect(landing).not.toContain('Local members see you&apos;re coming and reach out')
    expect(landing).not.toContain('Your Smileys community travels with you')
  })
  it('no weekly promise, no "once you are in" for public pages, honest stories line', () => {
    expect(landing).not.toContain('Something on every week')
    expect(landing).not.toContain('guide, handbook, and community boards')
    expect(landing).toContain('Stories, guides and words from the Smileys community.')
  })
  it('every live city\'s guide, and city suggestions arrive as their own topic', () => {
    expect(landing).toContain('{[...liveCities, ...founding].map(c => (')
    expect(landing).toContain('href="/contact?topic=city"')
    expect(read('app/contact/page.tsx')).toContain("{ value: 'city',        label: 'Suggest a city',")
    expect(read('app/api/contact/route.ts')).toContain("city:        'City suggestion',")
  })
})

describe('item 9: hero images', () => {
  it('the hidden hero never picks a real image and the visible one never the tiny one at 1024px', () => {
    for (const f of ['app/page.tsx', 'app/[city]/sections/Hero.tsx']) {
      const src = read(f)
      expect(src).toContain('sizes="(min-width: 1024px) 0px, (max-width: 639px) calc(100vw - 32px), calc(100vw - 48px)"')
      expect(src).toContain('sizes="(max-width: 1023px) 0px, (max-width: 1344px) calc(50vw - 64px), 576px"')
    }
  })
  it('the city card preloads only when asked', () => {
    expect(read('components/CityCard.tsx')).toContain('priority={priority}')
    expect(read('app/cities/page.tsx')).toContain('priority={live.length === 1 && i === 0}')
  })
})

describe('item 10: accessibility', () => {
  it('emoji hidden, labels above 4.5:1', () => {
    expect(landing.split('<div aria-hidden="true" className="text-3xl mb-4">{w.emoji}</div>').length - 1).toBe(2)
    expect(landing).toContain('<div aria-hidden="true" className="text-2xl mb-3">📖</div>')
    expect(landing).not.toContain('text-xs text-gray-400">{t.role}')
  })
  it('the tabs follow the ARIA pattern', () => {
    const tabs = read('components/EventTabs.tsx')
    expect(tabs).toContain('aria-controls={`${uid}-panel`}')
    expect(tabs).toContain('tabIndex={active ? 0 : -1}')
    expect(tabs).toContain('<div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>')
    expect(tabs).toContain("ev.key === 'ArrowRight'")
  })
  it('cards under a group label are one level down', () => {
    expect(landing).toContain('<CityCard key={c.id} city={c} headingLevel={4} />')
  })
})

describe('items 11–12: hero guards, clock, WebSite markup', () => {
  const route = read('app/api/admin/content/route.ts')
  it('trimmed hero text and an allowlist of public photo folders', () => {
    expect(route).toContain('headline:  str(r.headline, HEADLINE_MAX).trim(),')
    expect(route).toContain('/^\\/app\\/api\\/files\\/(general|cities)\\/')
    expect(landing).toContain("{home.headline?.trim() || 'Your people, in every city you land in.'}")
  })
  it('the tab window runs on the flagship\'s clock; the page declares its WebSite', () => {
    expect(landing).toContain('const eventWindow = eventWindowFor(flagship?.timezone ?? DEFAULT_TZ)')
    expect(landing).not.toContain('istanbulEventWindow()')
    expect(landing).toContain("'@type': 'WebSite'")
  })
})
