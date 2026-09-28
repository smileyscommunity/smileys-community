import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// City page scan 2026-09-29, items 1–5: the guest join link is in the server
// HTML; a guest's "announce your visit" goes to the application; the
// pre-launch button says it is an application; member event cards honour
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

describe('member event cards honour blocks and connections-only profiles (item 4)', () => {
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
  it('guests get the neighbourhood instead of the free-text location', () => {
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
