import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 6–11.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => ({
  waitlistEntry: { findMany: vi.fn() },
  user:          { findMany: vi.fn() },
  eventAttendee: { count: vi.fn(), findMany: vi.fn() },
  eventCoHost:   { findMany: vi.fn() },
}))
const gate = vi.hoisted(() => ({ blocked: new Set<string>() }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/noShow', () => ({
  getRsvpGate: vi.fn(async (userId: string) => gate.blocked.has(userId) ? { ok: false, code: 'red_card_blocked' } : { ok: true }),
}))

import { countSeatableFromWaitlist } from '@/lib/eventQuota'
import { projectEventsForMember } from '@/lib/db'

beforeEach(() => { vi.clearAllMocks(); gate.blocked.clear() })

describe('6. an open seat covers only a waiter who could take it', () => {
  const balanced = { genderBalance: true, maleQuota: null, femaleQuota: null, turkishMaleQuota: null, totalSpots: 10 }
  const setup = (queue: { userId: string; gender: string }[], males: number, females: number) => {
    p.waitlistEntry.findMany.mockResolvedValue(queue.map(q => ({ userId: q.userId })))
    p.user.findMany.mockResolvedValue(queue.map(q => ({ id: q.userId, gender: q.gender, nationality: 'France' })))
    p.eventAttendee.count.mockImplementation(async ({ where }: { where: { user: { gender: { in: string[] } } } }) =>
      where.user.gender.in.includes('male') ? males : females)
  }
  it('a free women\'s seat does not cover a waiting man', async () => {
    setup([{ userId: 'm1', gender: 'male' }], 5, 4)
    expect(await countSeatableFromWaitlist('e1', balanced, 1)).toBe(0)
  })
  it('it covers the first waiting woman behind him', async () => {
    setup([{ userId: 'm1', gender: 'male' }, { userId: 'w1', gender: 'female' }], 5, 4)
    expect(await countSeatableFromWaitlist('e1', balanced, 1)).toBe(1)
  })
  it('two women waiting for the last women\'s seat cover one seat, not two', async () => {
    setup([{ userId: 'w1', gender: 'female' }, { userId: 'w2', gender: 'female' }], 3, 4)
    expect(await countSeatableFromWaitlist('e1', balanced, 2)).toBe(1)
  })
  it('a member whose RSVPs are paused covers nothing', async () => {
    setup([{ userId: 'w1', gender: 'female' }], 3, 2)
    gate.blocked.add('w1')
    expect(await countSeatableFromWaitlist('e1', balanced, 1)).toBe(0)
  })
  it('the reconfirm release uses it on balanced events', () => {
    expect(read('lib/reconfirm.ts')).toContain('const covered = row?.genderBalance ? await countSeatableFromWaitlist(event.id, row, free) : Math.min(free, waiting)')
    expect(read('lib/reconfirm.ts')).toContain('const needed = waiting - covered')
  })
})

describe('7. the attendee CSV drops the Email column when emails were withheld', () => {
  it('builds the column only from rows that carry an email', () => {
    const src = read('app/admin/events/[id]/participants/page.tsx')
    expect(src).toContain("const withEmail = approved.some(a => !!a.user.email)")
    expect(src).toContain("...(withEmail ? ['Email'] : [])")
    expect(src).not.toContain("[a.user.name, a.user.email, a.status")
  })
})

describe('8. a failed report write hands its claim back', () => {
  it.each([
    ['app/api/reports/route.ts',                                    'report:${session.id}:${reportedId}'],
    ['app/api/board/[id]/report/route.ts',                          'report-board:${session.id}:${boardPostId}'],
    ['app/api/listings/[id]/report/route.ts',                       'report-listing:${session.id}:${listingId}'],
    ['app/api/neighborhoods/[slug]/posts/[postId]/report/route.ts', 'report-wall:${session.id}:${postId}'],
  ])('%s releases its claim when report.create throws', (file, key) => {
    const src = read(file)
    expect(src).toContain('.catch(async (e: unknown) => { await releaseClaim(`' + key + '`); throw e })')
    expect(src.indexOf('prisma.report.create(')).toBeLessThan(src.indexOf('await releaseClaim('))
  })
  it('the survey anomaly report releases its claim and skips the push when it fails', () => {
    const src = read('app/api/events/[id]/feedback/route.ts')
    expect(src).toContain('await releaseClaim(`survey-anomaly:${session.id}:${event.id}`)')
    expect(src).toContain('if (filed) prisma.user.findMany({')
  })
})

describe('9. the event page shows private details only to people on the event', () => {
  const src = read('app/events/[id]/page.tsx')
  it('uses the single-event API\'s rule instead of true', () => {
    expect(src).toContain('const canSeeLocation = canSeeInside')
    expect(src).not.toContain('const canSeeLocation = true')
  })
  it('gates the payment contact, the structured data and the client badge payload', () => {
    expect(src).toContain("{canSeeLocation && event.payTo === 'smileys' && (event.paymentContact || event.whatsappUrl) && (")
    expect(src).toContain('buildEventJsonLd(canSeeLocation ? event : redactEventForGuest(event), eventUrl, eventTz, cityName, cityCountry, !!event.meetingUrl)')
    expect(src).toContain('<EventBadges event={canSeeLocation ? event : redactEventForGuest(event)}')
  })
})

describe('10. member event lists carry private details only for events the viewer is on', () => {
  const ev = (id: string, hostId = 'h') => ({
    id, hostId, title: id, address: 'Street 1', lat: 41, lng: 29, meetingUrl: 'https://meet', whatsappUrl: 'https://wa', paymentContact: 'https://pay',
  }) as never
  it('keeps them for host, co-host and approved seat; strips them otherwise', async () => {
    p.eventAttendee.findMany.mockResolvedValue([{ eventId: 'seat' }])
    p.eventCoHost.findMany.mockResolvedValue([{ eventId: 'cohost' }])
    const out = await projectEventsForMember([ev('mine', 'u1'), ev('seat'), ev('cohost'), ev('other')], { id: 'u1', role: 'member' }) as unknown as Record<string, unknown>[]
    for (const kept of out.slice(0, 3)) expect(kept).toMatchObject({ address: 'Street 1', meetingUrl: 'https://meet', whatsappUrl: 'https://wa', paymentContact: 'https://pay', lat: 41 })
    expect(out[3]).toMatchObject({ address: undefined, lat: null, lng: null, meetingUrl: undefined, whatsappUrl: undefined, paymentContact: undefined })
    expect(p.eventAttendee.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', eventId: { in: ['mine', 'seat', 'cohost', 'other'] }, status: 'approved' })
  })
  it('admins and moderators get everything without a lookup', async () => {
    const out = await projectEventsForMember([ev('x')], { id: 'a', role: 'moderator' }) as unknown as Record<string, unknown>[]
    expect(out[0]).toMatchObject({ whatsappUrl: 'https://wa' })
    expect(p.eventAttendee.findMany).not.toHaveBeenCalled()
  })
  it.each([
    ['app/api/events/route.ts',          'session ? await projectEventsForMember(events, session)'],
    ['app/api/clubs/[slug]/route.ts',    'events: await projectEventsForMember(events, session)'],
    ['app/[city]/page.tsx',              'session ? await projectEventsForMember(cachedEvents, session)'],
    ['app/[city]/events/page.tsx',       'session ? await projectEventsForMember(cached, session)'],
    ['app/(member)/clubs/[slug]/page.tsx', 'session ? await projectEventsForMember(clubEvents, session)'],
  ])('%s applies it', (file, snippet) => {
    expect(read(file)).toContain(snippet)
  })
})

describe('11. club faces never expose hidden or private members, and guests get initials', () => {
  const src = read('app/api/clubs/route.ts')
  it('the cached faces query filters hidden and connections-only members', () => {
    expect(src).toContain(`AND u."hiddenFromMembers" = false AND u."profileVisibility" <> 'connections'`)
  })
  it('guests get a coloured initial, no name and no photo', () => {
    expect(src).toContain('faces: c.faces.map(f => ({ name: f.name.trim().charAt(0), color: f.color, profilePhoto: null })),')
  })
})
