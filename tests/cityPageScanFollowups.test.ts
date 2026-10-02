import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// City page scan 2026-09-29, items 1–5: the guest join link is in the server
// HTML; a guest's "announce your visit" goes to the application; the
// pre-launch button says it is an application; member event cards honor
// blocks and connections-only profiles; banned and suspended members leave
// event lists and visit cards; a members-only venue is not told to guests.

const p = vi.hoisted(() => ({
  eventAttendee: { findMany: vi.fn() },
  eventCoHost:   { findMany: vi.fn() },
  user:          { findMany: vi.fn() },
}))
const priv = vi.hoisted(() => ({ blocked: new Set<string>(), restricted: new Set<string>() }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/memberPrivacy', () => ({
  blockedIdsFor:    vi.fn(async () => priv.blocked),
  restrictedSetFor: vi.fn(async () => priv.restricted),
}))

import { projectEventsForMember, redactEventForGuest } from '@/lib/db'
import { visitAuthorOk } from '@/lib/visitorPolicy'
import type { Event } from '@/lib/data'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const me = { id: 'me', role: 'member', name: 'Me', email: 'me@x', color: '#000' }
const ev = (over: Partial<Event> = {}) => ({
  id: 'e1', hostId: 'host', hostName: 'Leyla Demir', hostPhoto: 'h.jpg', hostNationality: 'Turkey',
  location: 'Moda Seaside', neighborhood: 'Kadıköy', membersOnly: false,
  attendeePreviews: [
    { id: 'a1', name: 'Ayşe Yılmaz', color: '#111', profilePhoto: 'a1.jpg' },
    { id: 'a2', name: 'Mehmet Kaya', color: '#222', profilePhoto: 'a2.jpg' },
  ],
  ...over,
}) as unknown as Event

beforeEach(() => {
  vi.clearAllMocks(); priv.blocked = new Set(); priv.restricted = new Set()
  p.eventAttendee.findMany.mockResolvedValue([]); p.eventCoHost.findMany.mockResolvedValue([])
  p.user.findMany.mockResolvedValue([])
})

describe('member event cards honor blocks and connections-only profiles (item 4)', () => {
  it('a connections-only attendee outside my connections is a first name with no photo', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'a2', profileVisibility: 'connections' }])
    priv.restricted = new Set(['a2'])
    const [out] = await projectEventsForMember([ev()], me)
    expect(out.attendeePreviews).toEqual([
      { id: 'a1', name: 'Ayşe Yılmaz', color: '#111', profilePhoto: 'a1.jpg' },
      { id: 'a2', name: 'Mehmet', color: '#222', profilePhoto: null },
    ])
    expect(out.hostName).toBe('Leyla Demir')
  })
  it('a connections-only host outside my connections is a first name with no photo, id kept', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'host', profileVisibility: 'connections' }])
    priv.restricted = new Set(['host'])
    const [out] = await projectEventsForMember([ev()], me)
    expect(out).toMatchObject({ hostName: 'Leyla', hostPhoto: null, hostNationality: null, hostId: 'host' })
  })
  it('a blocked attendee leaves the previews; a blocked host loses the name, the face and the id', async () => {
    priv.blocked = new Set(['a1', 'host'])
    const [out] = await projectEventsForMember([ev()], me)
    expect(out.attendeePreviews?.map(a => a.id)).toEqual(['a2'])
    expect(out).toMatchObject({ hostName: 'Leyla', hostPhoto: null, hostId: '' })
  })
  it('asks only about the people on the cards, never the viewer, and only for connections-only rows', async () => {
    await projectEventsForMember([ev({ hostId: 'me' })], me)
    expect(p.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['a1', 'a2'] }, profileVisibility: 'connections' })
  })
})

describe('a members-only venue is not told to guests (item 5)', () => {
  it('guests get the neighborhood instead of the free-text location', () => {
    expect(redactEventForGuest(ev({ membersOnly: true, location: "Ayşe's flat, Cihangir Sk. 12/3" })).location).toBe('Kadıköy')
    expect(redactEventForGuest(ev({ membersOnly: true, neighborhood: '' as never })).location).toBe('Shared with members')
    expect(redactEventForGuest(ev()).location).toBe('Moda Seaside')
  })
})

describe('banned and suspended members leave event lists and visit cards (item 5)', () => {
  const db = read('lib/db.ts')
  it('getEvents excludes their hosted events and their previews', () => {
    expect(db).toContain("prisma.user.findMany({ where: { OR: [{ status: 'banned' }, { suspendedUntil: { gt: new Date() } }] }, select: { id: true } }),")
    expect(db).toContain('...(unlistableIds.length ? { hostId: { notIn: unlistableIds } } : {}),')
    expect(db).toContain('e.attendeePreviews = e.attendeePreviews.filter(p => !hideAttendee.has(p.id))')
  })
  it('one visit-author rule with the suspension arm, used by all three surfaces', () => {
    const where = visitAuthorOk() as unknown as { OR: [unknown, { user: { OR: { suspendedUntil: unknown }[] } }] }
    expect(where.OR[0]).toEqual({ userId: null })
    expect(where.OR[1].user).toMatchObject({ status: 'approved', hiddenFromMembers: false })
    expect(where.OR[1].user.OR[0]).toEqual({ suspendedUntil: null })
    for (const f of ['app/[city]/data.ts', 'app/visiting/page.tsx', 'app/api/visitors/route.ts']) {
      expect(read(f)).toContain('visitAuthorOk()')
      expect(read(f)).not.toContain("{ user: { status: 'approved', hiddenFromMembers: false } }] }")
    }
  })
})

describe('the guest CTAs (items 1–3)', () => {
  const button = read('components/JoinCityButton.tsx')
  it('the join button renders the guest link on the server when the page says guest', () => {
    expect(button).toContain('if (isLoading && !guest) {')
    expect(button).toContain('guest = false,')
  })
  it('every city page caller passes the flag', () => {
    for (const f of ['app/[city]/sections/Hero.tsx', 'app/[city]/sections/Events.tsx', 'app/[city]/sections/FinalCta.tsx']) {
      expect(read(f)).toContain('guest={!signedIn}')
    }
    expect(read('app/[city]/sections/PreLaunch.tsx')).toContain('live={false} guest={!signedIn}')
    const page = read('app/[city]/page.tsx')
    expect(page).toContain('<PreLaunch city={city} signedIn={!!session} />')
    expect(page.indexOf('const session = await getSession()')).toBeLessThan(page.indexOf('<PreLaunch'))
    for (const f of ['app/[city]/moving/page.tsx', 'app/[city]/students/page.tsx', 'app/[city]/remote-work/page.tsx', 'app/[city]/events/page.tsx', 'app/[city]/experiences/page.tsx']) {
      expect(read(f)).not.toMatch(/<JoinCityButton (?![^>]*guest=)[^>]*\/>/)
    }
  })
  it('a guest\'s announce button goes to the application', () => {
    const v = read('app/[city]/sections/Visitors.tsx')
    expect(v).toContain('href={signedIn ? `/visiting/new?city=${city.slug}` : `/apply?city=${city.slug}`}')
    expect(v).toContain("{signedIn ? 'Announce your visit' : 'Join to announce your visit'}")
  })
  it('the pre-launch guest button says it is an application', () => {
    expect(button).toContain('`Apply to join Smileys ${name}`')
    expect(button).not.toContain('Get notified about')
    expect(read('app/[city]/sections/PreLaunch.tsx')).not.toContain('Join the list')
  })
})

// Items 6–10 (2026-09-29): city-carrying guest links, the small city-losing
// links, stage-honest copy, honestly framed quotes and stories, the meta
// description.

import { cityMetadata } from '@/app/[city]/data'

describe('items 6–7: links keep the city', () => {
  it('the clubs empty state and the stories link carry the city; /posts reads ?city=', () => {
    expect(read('app/[city]/sections/Clubs.tsx')).toContain('<Link href={`/get-involved${cityQs(city.slug)}`} className="btn-primary inline-flex">Become a host</Link>')
    expect(read('app/[city]/sections/Stories.tsx')).toContain('href={`/posts${cityQs(city.slug)}`}')
    const posts = read('app/posts/page.tsx')
    expect(posts).toContain('const { cityId } = await resolveCityForPage(searchParams)')
    expect(posts).not.toContain('resolveCityId(session)')
  })
})

describe('item 8: the copy follows the calendar', () => {
  const hero = read('app/[city]/sections/Hero.tsx')
  it('a seeding city with no events is not told its first events are on the calendar', () => {
    expect(hero).toContain('forming, and the first event is still to be set')
    expect(hero).toContain('? stats.events > 0')
  })
  it('the applicant line is for guests only', () => {
    expect(hero).toContain('{!signedIn ? (')
  })
  it('the closing CTA follows the calendar', () => {
    const cta = read('app/[city]/sections/FinalCta.tsx')
    expect(cta).toContain("hasEvents ? `See what's on in ${city.name} this week.` : `Nothing on the ${city.name} calendar yet — the clubs are where it starts.`")
    expect(cta).toContain('See the clubs')
    expect(read('app/[city]/page.tsx')).toContain('hasEvents={tabEvents.length > 0}')
  })
})

describe('items 8 + 10: metadata', () => {
  const base = { id: 'c', slug: 'bursa', name: 'Bursa', status: 'live', heroImage: null, description: 'A long hero paragraph. '.repeat(20), tagline: 'Short line.' }
  it('a seeding city is not titled "discover events"; a growing one is', () => {
    expect(cityMetadata({ ...base, stats: { members: 0, clubs: 3, events: 0, maturity: 'seeding' } } as never).title).toBe('Smileys Bursa — join the founding members')
    expect(cityMetadata({ ...base, stats: { members: 900, clubs: 50, events: 30, maturity: 'self_sustaining' } } as never).title).toBe('Smileys Bursa — meet people, join clubs, discover events')
  })
  it('the description is the tagline first', () => {
    expect(cityMetadata({ ...base } as never).description).toBe('Short line.')
    expect(cityMetadata({ ...base, tagline: null } as never).description).toBe(base.description)
  })
  it('a preparing city is not called coming soon', () => {
    expect(cityMetadata({ ...base, status: 'preparing' } as never).title).toBe('Smileys Bursa — in preparation')
    expect(cityMetadata({ ...base, status: 'coming_soon' } as never).title).toBe('Smileys Bursa — coming soon')
  })
})

describe('item 9: quotes and stories say whose they are', () => {
  it('the city\'s own quotes lead, over-fetched then cut to three', () => {
    const data = read('app/[city]/data.ts')
    expect(data).toContain('take:    6,')
    expect(data).toContain('const shownTestimonials = ownFirst(testimonials).slice(0, 3)')
  })
  it('the subtitles name the city only for the city\'s own words', () => {
    const t = read('app/[city]/sections/Testimonials.tsx')
    expect(t).toContain("'Real stories from Smileys members in our other cities.'")
    expect(t).not.toContain('Real stories from real members.')
    const s = read('app/[city]/sections/Stories.tsx')
    expect(s).toContain('const hasOwn = latestStories.some(p => p.cityId === city.id)')
    expect(s).not.toContain('>Real writing from the community.<')
  })
})

// Items 11–16 (2026-09-29): the cache is refreshed by the writes that change
// the page; the page carries its own structured data; no borrowed photo;
// per-city sitemap dates; decorative emoji; one "upcoming" window.

import { startedCutoff } from '@/lib/cityTime'

describe('item 11: admin writes refresh the city pages', () => {
  it('the helper busts the tag the loaders use, safely outside a request', () => {
    const h = read('lib/cityPageCache.ts')
    expect(h).toContain("export const CITY_PAGE_TAG = 'home'")
    expect(h).toContain('try { revalidateTag(CITY_PAGE_TAG); revalidateTag(WHY_PAGE_TAG) } catch {')
    expect(read('app/[city]/data.ts')).toContain("tags: ['home']")
  })
  it('event create/edit/status/delete/duplicate, quotes and city edits call it', () => {
    expect(read('app/api/admin/events/route.ts')).toContain('bustCityPages()\n    return NextResponse.json(event)')
    expect(read('app/api/admin/events/[id]/route.ts').split('bustCityPages()').length - 1).toBe(3)
    expect(read('app/api/admin/events/[id]/duplicate/route.ts')).toContain('bustCityPages()')
    expect(read('app/api/admin/testimonials/route.ts')).toContain('bustCityPages()')
    expect(read('app/api/admin/testimonials/[id]/route.ts').split('bustCityPages()').length - 1).toBe(2)
    expect(read('app/api/admin/cities/[id]/route.ts')).toContain('const updated = await prisma.city.update({ where: { id }, data })\n  // Hero, tagline, description and status all render on the city page.\n  bustCityPages()')
  })
})

describe('item 12: the city page has its own structured data', () => {
  const page = read('app/[city]/page.tsx')
  it('a WebPage about the city and a breadcrumb, escaped, on live and pre-launch pages', () => {
    expect(page).toContain("about: { '@type': 'City', name: city.name },")
    expect(page).toContain("{ '@type': 'ListItem', position: 3, name: city.name, item: url },")
    expect(page).toContain('dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }}')
    expect(page.split('<CityJsonLd city={city} />').length - 1).toBe(2)
  })
})

describe('item 13: no borrowed hero photo', () => {
  const img = read('app/[city]/sections/CityHeroImage.tsx')
  it('a city without a hero gets a brand panel with its name, not Istanbul\'s photo', () => {
    expect(img).not.toContain('hero-istanbul.jpg')
    expect(img).toContain('if (!city.heroImage) {')
    expect(img).toContain('alt={city.name}')
    expect(img).not.toContain('Smileys members in')
  })
})

describe('item 14: each city page carries its own freshness', () => {
  it('lastModified comes from the city\'s own events and clubs', () => {
    const sm = read('app/sitemap.ts')
    expect(sm).toContain('...events.filter(e => e.cityId === c.id).map(e => e.updatedAt),')
    expect(sm).toContain('...clubs.filter(cl => cl.cityId === c.id).map(cl => cl.createdAt),')
    expect(sm).not.toContain('lastModified: newest([newestEvent, newestClub]) }')
  })
})

describe('item 15: decorative emoji', () => {
  it('the neighborhood tiles hide their emoji from screen readers', () => {
    expect(read('app/[city]/sections/Neighborhoods.tsx')).toContain('<span aria-hidden="true" className="text-3xl">{n.emoji}</span>')
  })
})

describe('item 16: one upcoming window for the hero count and the list', () => {
  it('the cutoff is five hours back, clamped at midnight', () => {
    // 2026-09-29 18:30 Istanbul (UTC+3) = 15:30Z → cutoff 13:30
    expect(startedCutoff('Europe/Istanbul', new Date('2026-09-29T15:30:00Z'))).toEqual({ today: '2026-09-29', cutoffTime: '13:30' })
    // 02:00 Istanbul → clamped to 00:00
    expect(startedCutoff('Europe/Istanbul', new Date('2026-09-28T23:00:00Z'))).toEqual({ today: '2026-09-29', cutoffTime: '00:00' })
  })
  it('both the event list and the city stats use it', () => {
    expect(read('lib/db.ts')).toContain('const { today, cutoffTime } = startedCutoff(tz)')
    const cities = read('lib/cities.ts')
    expect(cities).toContain('const { today, cutoffTime } = startedCutoff(tzOf(id))')
    expect(cities).toContain('return [{ cityId: id, date: { gt: today } }, { cityId: id, date: today, time: { gte: cutoffTime } }]')
    expect(cities).not.toContain('date: { gte: todayOf(id) } })) },')
  })
})
