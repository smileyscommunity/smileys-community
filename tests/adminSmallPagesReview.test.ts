import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

// Review fixes, 2026-09-19 — the smaller admin pages: no-show appeals order
// and blank reject note, pro-waitlist totals, poll history paging, expired
// moving sales, spotlight member status + city label, participants' per-city
// "today", and the Instagram handle on settings.

const h = vi.hoisted(() => {
  const prisma = {
    noShowCard:       { findMany: vi.fn(async () => []) },
    proWaitlistEntry: { findMany: vi.fn(async () => []), count: vi.fn() },
    communityPoll:    { findMany: vi.fn(async () => []) },
    movingSale:       { findMany: vi.fn(async () => []) },
    user:             { findUnique: vi.fn() },
    eventAttendee:    { findMany: vi.fn(async () => []) },
    waitlistEntry:    { findMany: vi.fn(async () => []) },
  }
  const fs = { file: '{}' as string, written: null as string | null }
  return { prisma, fs }
})

vi.mock('@/lib/prisma',  () => ({ prisma: h.prisma }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',   () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/city',    () => ({
  citiesByToday: vi.fn(async () => [
    { date: '2026-09-19', cityIds: ['c-ist', 'c-izm'] },
    { date: '2026-09-18', cityIds: ['c-nyc'] },
  ]),
}))
// Spotlight and settings keep their state in JSON files.
vi.mock('fs', async (orig) => {
  const real = await orig<typeof import('fs')>()
  return {
    ...real,
    readFileSync: vi.fn((path: any, enc?: any) =>
      String(path).includes('/data/') ? h.fs.file : real.readFileSync(path, enc)),
    writeFileSync: vi.fn((_p: any, data: any) => { h.fs.written = String(data) }),
    renameSync:    vi.fn(),
  }
})

import { getSession } from '@/lib/session'
import { GET as cardsGET } from '@/app/api/admin/no-show/cards/route'
import { GET as waitlistGET } from '@/app/api/admin/pro-waitlist/route'
import { GET as pollsGET } from '@/app/api/admin/community-poll/route'
import { GET as salesGET } from '@/app/api/admin/moving-sales/route'
import { GET as spotlightGET } from '@/app/api/admin/spotlight/route'
import { GET as participantsGET } from '@/app/api/admin/participants/route'
import { POST as settingsPOST } from '@/app/api/admin/settings/route'

const p = h.prisma as any
const admin  = { id: 'a1', name: 'Admin', role: 'admin', email: 'a@x', color: '#000' }
const member = { id: 'm1', name: 'Mem',   role: 'member', email: 'm@x', color: '#000' }
const src = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8')

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(admin)
  h.fs.file = '{}'
  h.fs.written = null
})
afterEach(() => vi.useRealTimers())

describe('no-show appeals', () => {
  it('the appeals inbox lists whoever has waited longest first', async () => {
    await cardsGET(new NextRequest('https://x/app/api/admin/no-show/cards?status=appeal_pending'))
    expect(p.noShowCard.findMany.mock.calls[0][0].orderBy).toEqual([{ appealedAt: 'asc' }, { issuedAt: 'asc' }])
  })

  it('the history views stay newest first', async () => {
    await cardsGET(new NextRequest('https://x/app/api/admin/no-show/cards?status=all'))
    expect(p.noShowCard.findMany.mock.calls[0][0].orderBy).toEqual([{ appealedAt: 'desc' }, { issuedAt: 'desc' }])
  })

  it('"leave blank to skip" can actually be left blank', () => {
    expect(src('app/admin/no-shows/page.tsx')).toMatch(/leave blank to skip\)'[^\n]*allowEmpty: true/)
    const prompt = src('lib/promptToast.tsx')
    expect(prompt).toContain('const canConfirm = allowEmpty || !!value.trim()')
    expect(prompt).toContain('disabled={!canConfirm}')
  })
})

describe('pro waitlist', () => {
  it('reports the real totals, not the length of the 500-row page', async () => {
    p.proWaitlistEntry.findMany.mockResolvedValue(Array.from({ length: 500 }, (_, i) => ({ id: `w${i}`, status: 'waitlisted' })))
    p.proWaitlistEntry.count.mockImplementation(async (arg?: any) =>
      !arg ? 1234 : arg.where.status === 'converted' ? 17 : 88)
    const { summary } = await (await waitlistGET()).json()
    expect(summary).toMatchObject({ total: 1234, founders: 100, converted: 17, invited: 88, shown: 500, capped: true })
  })
})

describe('poll history', () => {
  it('pages past the first few polls with ?after=', async () => {
    await pollsGET(new NextRequest('https://x/app/api/admin/community-poll'))
    const first = p.communityPoll.findMany.mock.calls[0][0]
    expect(first.take).toBe(10)
    expect(first.cursor).toBeUndefined()
    await pollsGET(new NextRequest('https://x/app/api/admin/community-poll?after=poll-9'))
    expect(p.communityPoll.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'poll-9' }, skip: 1 })
  })
})

describe('moving sales', () => {
  it("a sale whose leaving day is behind its own city is expired; a city still on that day isn't", async () => {
    // 02:00 UTC: already the 19th in Istanbul, still the 18th in New York.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-19T02:00:00Z'))
    const sale = (id: string, timezone: string) => ({
      id, leavingOn: '2026-09-18', status: 'active', items: [],
      user: { id: 'u', name: 'U', email: 'u@x', color: '#000' },
      city: { name: id, slug: id, timezone },
    })
    p.movingSale.findMany.mockResolvedValue([sale('ist', 'Europe/Istanbul'), sale('nyc', 'America/New_York')])
    const { sales } = await (await salesGET()).json()
    expect(sales.map((s: any) => [s.id, s.expired])).toEqual([['ist', true], ['nyc', false]])
    // The timezone was only for the judgement; the page gets the same city shape as before.
    expect(sales[0].city).toEqual({ name: 'ist', slug: 'ist' })
  })

  it('the page\'s "active" tab leaves expired sales out', () => {
    expect(src('app/admin/moving-sales/page.tsx')).toContain("(s.status === status && !(status === 'active' && s.expired))")
  })
})

describe('spotlight', () => {
  const featured = (over: Record<string, unknown>) => ({
    id: 'u9', name: 'Ayla', color: '#000', profilePhoto: null, neighborhood: null, bio: null,
    status: 'approved', hiddenFromMembers: false, city: { name: 'İzmir' }, ...over,
  })

  it('a suspended member is no spotlight for members', async () => {
    h.fs.file = JSON.stringify({ userId: 'u9', funFact: '', topSpots: ['', '', ''] })
    p.user.findUnique.mockResolvedValue(featured({ status: 'suspended' }))
    ;(getSession as any).mockResolvedValue(member)
    expect(await (await spotlightGET()).json()).toBeNull()
  })

  it('an admin-hidden member is flagged to staff instead of shown as live', async () => {
    h.fs.file = JSON.stringify({ userId: 'u9', funFact: '', topSpots: ['', '', ''] })
    p.user.findUnique.mockResolvedValue(featured({ hiddenFromMembers: true }))
    const body = await (await spotlightGET()).json()
    expect(body.unavailable).toBe(true)
    expect(body.user).not.toHaveProperty('status')
  })

  it("an approved member carries their city for the label", async () => {
    h.fs.file = JSON.stringify({ userId: 'u9', funFact: '', topSpots: ['', '', ''] })
    p.user.findUnique.mockResolvedValue(featured({}))
    const body = await (await spotlightGET()).json()
    expect(body.unavailable).toBeUndefined()
    expect(body.user.city).toEqual({ name: 'İzmir' })
    const page = src('app/admin/spotlight/page.tsx')
    expect(page).not.toContain('Istanbul spots')
  })
})

describe('participants inbox', () => {
  it('"upcoming" is judged on each event\'s city calendar', async () => {
    await participantsGET()
    expect(p.eventAttendee.findMany.mock.calls[0][0].where.event).toEqual({ OR: [
      { cityId: { in: ['c-ist', 'c-izm'] }, date: { gte: '2026-09-19' } },
      { cityId: { in: ['c-nyc'] },          date: { gte: '2026-09-18' } },
    ] })
  })
})

describe('settings — instagram', () => {
  const save = (instagram: string) => settingsPOST(new NextRequest('https://x/app/api/admin/settings', {
    method: 'POST', body: JSON.stringify({ instagram }),
  }))

  it.each([
    ['https://instagram.com/smileys.community/', '@smileys.community'],
    ['https://www.instagram.com/smileys.community?igsh=abc', '@smileys.community'],
    ['@smileys.community', '@smileys.community'],
    ['smileys.community', '@smileys.community'],
  ])('%s is stored as a handle', async (input, stored) => {
    const res = await save(input)
    expect(res.status).toBe(200)
    expect(JSON.parse(h.fs.written!).instagram).toBe(stored)
  })

  it('clearing the field stores an empty value', async () => {
    expect((await save('  ')).status).toBe(200)
    expect(JSON.parse(h.fs.written!).instagram).toBe('')
  })

  it("another site's link is refused rather than saved as a dead value", async () => {
    const res = await save('https://evil.com/smileys')
    expect(res.status).toBe(400)
    expect(h.fs.written).toBeNull()
  })
})
