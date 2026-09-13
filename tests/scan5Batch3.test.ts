import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 12–15: stealth and hidden attendees, hangout chat, club resources.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => ({
  club:           { findUnique: vi.fn() },
  clubMembership: { findUnique: vi.fn() },
  clubResource:   { findMany: vi.fn() },
}))
const session = vi.hoisted(() => ({ current: { id: 'u1', role: 'member' } as { id: string; role: string } | null }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/access', () => ({ canActInCity: vi.fn(() => false) }))

import { GET as resourcesGET } from '@/app/api/clubs/[slug]/resources/route'

const get = () => resourcesGET(new Request('http://x/api/clubs/hikers/resources') as never, { params: Promise.resolve({ slug: 'hikers' }) })

beforeEach(() => {
  vi.clearAllMocks()
  session.current = { id: 'u1', role: 'member' }
  p.club.findUnique.mockResolvedValue({ id: 'c1' })
  p.clubResource.findMany.mockResolvedValue([{ id: 'r1', title: 'WhatsApp', url: 'https://chat.whatsapp.com/x' }])
})

describe('12. the dashboard never announces a stealth or hidden RSVP', () => {
  it('filters the recent-RSVP feed like every other roster', () => {
    const src = read('app/(member)/dashboard/page.tsx')
    const feed = src.slice(src.indexOf('// Recent RSVPs to events'), src.indexOf('// Clubs created in the last 14 days'))
    expect(feed).toContain("stealth:   false,")
    expect(feed).toContain("user:      { hiddenFromMembers: false },")
  })
})

describe('13. the club events tab leaves stealth and hidden attendees out', () => {
  it('filters the attendee stack query', () => {
    expect(read('app/(member)/clubs/[slug]/page.tsx')).toContain(
      "where: { eventId: { in: eventIds }, status: 'approved', stealth: false, user: { hiddenFromMembers: false }, userId: { in: memberIds } },")
  })
})

describe('14. hangout chat reaches only the host and people who are in', () => {
  it('the page passes messages only to them', () => {
    expect(read('app/(member)/hangouts/[id]/page.tsx')).toContain('initialMessages={isOwner || joinedByMe ? hangout.messages : []}')
  })
  it('everyone else is told the chat is for people who are in, not that it is empty', () => {
    expect(read('components/HangoutDiscussion.tsx')).toContain("'The chat is for people who are in.'")
  })
})

describe('15. club resources are for members and staff', () => {
  it('the page hands them only to viewers who see member content', () => {
    expect(read('app/(member)/clubs/[slug]/page.tsx')).toContain('initialResources={canSeeMemberContent ? resources : []}')
  })
  it('the API refuses a signed-in non-member and a pending requester', async () => {
    p.clubMembership.findUnique.mockResolvedValueOnce(null)
    expect((await get()).status).toBe(403)
    p.clubMembership.findUnique.mockResolvedValueOnce({ status: 'pending' })
    expect((await get()).status).toBe(403)
    expect(p.clubResource.findMany).not.toHaveBeenCalled()
  })
  it('the API serves an approved member and staff', async () => {
    p.clubMembership.findUnique.mockResolvedValueOnce({ status: 'approved' })
    expect((await get()).status).toBe(200)
    session.current = { id: 'm1', role: 'moderator' }
    expect((await get()).status).toBe(200)
    expect(p.clubMembership.findUnique).toHaveBeenCalledTimes(1)
  })
  it('still refuses logged-out requests', async () => {
    session.current = null
    expect((await get()).status).toBe(401)
  })
})
