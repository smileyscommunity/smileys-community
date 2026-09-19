import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan-5 item 86 (+ the CSV half of 88): admin participants, check-in and the
// moderation queues. Pure rules live in lib/admin/participantsView and are
// tested as behaviour; the two participants GETs are exercised with a mocked
// prisma; the .tsx wiring is pinned by source.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/access',  () => ({ isAdmin: vi.fn(), isClubHost: vi.fn(), canManageEventOps: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/city',    () => ({ todayInCity: vi.fn().mockResolvedValue('2026-09-14'), resolveCityId: vi.fn().mockResolvedValue('ist'), citiesByToday: vi.fn().mockResolvedValue([{ date: '2026-09-14', cityIds: ['ist'] }]) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/email',   () => ({ sendEventApprovedEmail: vi.fn(), sendEventRejectedEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/autoJoinClub', () => ({ autoJoinClub: vi.fn() }))
vi.mock('@/lib/spotsLeft',    () => ({ recomputeSpotsLeft: vi.fn() }))
vi.mock('@/lib/audit',        () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/eventQuota',   () => ({ findPromotableFromWaitlist: vi.fn(), hasQuotaRoomFor: vi.fn(), quotaEventSelect: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  eventAttendee:  { findMany: vi.fn() },
  waitlistEntry:  { findMany: vi.fn() },
  eventCoHost:    { findMany: vi.fn().mockResolvedValue([]) },
  event:          { findUnique: vi.fn().mockResolvedValue({ hostId: 'h1' }), findMany: vi.fn() },
  payment:        { findMany: vi.fn().mockResolvedValue([]) },
  noShowCard:     { findMany: vi.fn().mockResolvedValue([]) },
  user:           { findMany: vi.fn() },
  clubMembership: { findMany: vi.fn().mockResolvedValue([]) },
} }))

import { isEventFull, promotableSeats, matchesPersonSearch, csvCell, toCsv } from '@/lib/admin/participantsView'
import { GET as inboxGET } from '@/app/api/admin/participants/route'
import { GET as eventParticipantsGET } from '@/app/api/admin/events/[id]/participants/route'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { prisma } from '@/lib/prisma'

const read = (f: string) => readFileSync(f, 'utf8')
const p = prisma as any

describe('a) "Full" only on a limited event at its cap', () => {
  it('unlimited events are never full, however far past the nominal total', () => {
    expect(isEventFull({ limitedSpots: false, spotsLeft: 0,  totalSpots: 20 })).toBe(false)
    expect(isEventFull({ limitedSpots: false, spotsLeft: -7, totalSpots: 20 })).toBe(false)
    expect(isEventFull({ spotsLeft: 0, totalSpots: 20 })).toBe(false)
    expect(isEventFull({ limitedSpots: null, spotsLeft: 0, totalSpots: 20 })).toBe(false)
  })
  it('limited events are full at or past the cap, not before, and never with no cap size', () => {
    expect(isEventFull({ limitedSpots: true, spotsLeft: 0,  totalSpots: 20 })).toBe(true)
    expect(isEventFull({ limitedSpots: true, spotsLeft: -1, totalSpots: 20 })).toBe(true)
    expect(isEventFull({ limitedSpots: true, spotsLeft: 1,  totalSpots: 20 })).toBe(false)
    expect(isEventFull({ limitedSpots: true, spotsLeft: 0,  totalSpots: 0 })).toBe(false)
  })
  it('batch promotion is capped by open seats only on limited events', () => {
    expect(promotableSeats({ limitedSpots: true,  spotsLeft: 3,  totalSpots: 20 })).toBe(3)
    expect(promotableSeats({ limitedSpots: true,  spotsLeft: -2, totalSpots: 20 })).toBe(0)
    expect(promotableSeats({ limitedSpots: false, spotsLeft: -2, totalSpots: 20 })).toBe(Number.POSITIVE_INFINITY)
    expect(['a', 'b', 'c'].slice(0, promotableSeats({ limitedSpots: false, spotsLeft: 0, totalSpots: 2 }))).toHaveLength(3)
  })
  it('the pages use the shared rule', () => {
    const inbox = read('app/admin/participants/page.tsx')
    expect(inbox).toContain('if (event.totalSpots <= 0 || event.limitedSpots !== true) return null')
    expect(inbox).toContain('const full = isEventFull(group.event)')
    expect(inbox).not.toContain('group.event.totalSpots > 0 && group.event.spotsLeft <= 0')
    const perEvent = read('app/admin/events/[id]/participants/page.tsx')
    expect(perEvent).toContain('const full             = isEventFull(event)')
    expect(perEvent).toContain('{full && <span className="ml-2 text-red-400 font-bold">FULL</span>}')
    expect(perEvent).not.toContain('event.spotsLeft === 0')
    expect(perEvent).toContain('const promotable       = Math.min(waitlist.length, promotableSeats(event))')
  })
})

describe('b) check-in / participants search is null-safe', () => {
  it('matches name or email, case-insensitively, and survives a missing email or user', () => {
    expect(matchesPersonSearch({ name: 'Ayşe Demir' }, 'demir')).toBe(true)
    expect(matchesPersonSearch({ name: 'Ayşe Demir', email: undefined }, 'gmail')).toBe(false)
    expect(matchesPersonSearch({ name: 'Can', email: null }, 'CAN')).toBe(true)
    expect(matchesPersonSearch({ name: 'Can', email: 'Can.K@Mail.com' }, 'can.k@')).toBe(true)
    expect(matchesPersonSearch(undefined, 'x')).toBe(false)
    expect(matchesPersonSearch(undefined, '  ')).toBe(true)
  })
  it('admin check-in and the participants inbox no longer call .email.toLowerCase()', () => {
    for (const f of ['app/admin/checkin/page.tsx', 'app/admin/participants/page.tsx']) {
      const src = read(f)
      expect(src).not.toContain('email.toLowerCase()')
      expect(src).toContain('matchesPersonSearch(')
    }
    expect(read('app/admin/checkin/page.tsx')).toContain('email?: string | null')
  })
})

describe('c) queue pages show a failed load as an error, not an empty list', () => {
  it('moderation: a failed feed keeps its data and names itself in the banner', () => {
    const src = read('app/admin/moderation/page.tsx')
    expect(src).toContain('if (!r.ok) throw await loadFailure(r)')
    expect(src).toContain('if (r  !== null) setReports(')
    expect(src).toContain("setLoadError(failed.length ? failed.join(' · ') : null)")
    expect(src).toContain('<LoadErrorBanner message={loadError} onRetry={() => load()}')
  })
  it('applications: banner with retry, and no "No pending applications" under it', () => {
    const src = read('app/admin/applications/page.tsx')
    expect(src).toContain('<LoadErrorBanner message={loadError} onRetry={loadApps}')
    expect(src).toContain('{!loading && !loadError && visible.length === 0 && (')
    expect(src).toMatch(/\}\)\.catch\(\(\) => setLoadError\(/)
  })
  it('admin check-in: events and attendees loads both surface a retry', () => {
    const src = read('app/admin/checkin/page.tsx')
    expect(src.match(/if \(!r\.ok\) throw await loadFailure\(r\)/g)).toHaveLength(2)
    expect(src).toContain('}, [selectedId, attsTick])')
    expect(src).toContain('{!loadingAtts && !attsError && filtered.length === 0 && (')
  })
  it('per-event participants: a refused roster raises a banner; a 404 event is still "not found"', () => {
    const src = read('app/admin/events/[id]/participants/page.tsx')
    expect(src).toContain("r.status === 404 ? null : strict(r)")
    expect(src).toContain('.catch((e: Error) => setLoadError(')
    expect(src).toContain('if (loadError && !event) return')
  })
  it('directory claims/reports: the failure toast carries a Retry', () => {
    const src = read('app/admin/directory/page.tsx')
    expect(src.match(/\{ action: \{ label: 'Retry', onClick: \(\) => load\(\) \} \}/g)).toHaveLength(4)
  })
})

describe('d) no club / deleted host / deleted member', () => {
  it('moderation queue renders a fallback for a null host or club', () => {
    const src = read('app/admin/moderation/page.tsx')
    expect(src).not.toContain('{e.host.name}')
    expect(src).not.toContain('{e.club.name}')
    expect(src).toContain("{e.host?.name ?? 'Deleted member'}")
    expect(src).toContain("{e.club?.name ?? 'No club'}")
    expect(src).toContain('(e.host?.name.toLowerCase().includes(s) ?? false)')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    p.eventCoHost.findMany.mockResolvedValue([])
    p.event.findUnique.mockResolvedValue({ hostId: 'h1' })
    p.payment.findMany.mockResolvedValue([])
    p.noShowCard.findMany.mockResolvedValue([])
    p.clubMembership.findMany.mockResolvedValue([])
  })

  it('per-event participants GET drops waitlist rows whose member no longer exists', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'admin', role: 'admin' })
    p.eventAttendee.findMany.mockResolvedValue([])
    p.waitlistEntry.findMany.mockResolvedValue([
      { id: 'w1', userId: 'alive', eventId: 'e1', createdAt: new Date() },
      { id: 'w2', userId: 'gone',  eventId: 'e1', createdAt: new Date() },
    ])
    p.user.findMany.mockResolvedValue([{ id: 'alive', name: 'Alive', color: 'c', email: 'a@x' }])
    const res  = await eventParticipantsGET(new Request('https://x/app/api/admin/events/e1/participants') as any, { params: Promise.resolve({ id: 'e1' }) })
    const body = await res.json()
    expect(body.waitlist.map((w: any) => w.userId)).toEqual(['alive'])
  })

  it('participants inbox GET returns limitedSpots + cityId and drops orphan waitlist rows', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'admin', role: 'admin' })
    ;(isAdmin as any).mockReturnValue(true)
    const ev = { id: 'e1', title: 'Picnic', date: '2026-09-20', emoji: '🧺', status: 'published', spotsLeft: -3, totalSpots: 20, limitedSpots: false, cityId: 'tbs' }
    p.eventAttendee.findMany.mockResolvedValue([])
    p.waitlistEntry.findMany.mockResolvedValue([
      { id: 'w1', userId: 'alive', eventId: 'e1', createdAt: new Date() },
      { id: 'w2', userId: 'gone',  eventId: 'e1', createdAt: new Date() },
    ])
    p.user.findMany.mockResolvedValue([{ id: 'alive', name: 'Alive', color: 'c', email: 'a@x' }])
    p.event.findMany.mockResolvedValue([ev])
    const body = await (await inboxGET()).json()
    expect(body.waitlist.map((w: any) => w.userId)).toEqual(['alive'])
    const select = p.eventAttendee.findMany.mock.calls[0][0].include.event.select
    expect(select).toMatchObject({ limitedSpots: true, cityId: true, spotsLeft: true, totalSpots: true })
    expect(p.event.findMany.mock.calls[0][0].select).toMatchObject({ limitedSpots: true, cityId: true })
  })
})

describe('e) currency and timezone follow the event', () => {
  it('per-event participants: event currency, city-tz sweep time and waitlist day', () => {
    const src = read('app/admin/events/[id]/participants/page.tsx')
    expect(src).toContain('const cur              = event.currency ?? cityCurrency')
    expect(src).toContain("hourCycle: 'h23', timeZone: eventTz })")
    expect(src).toContain("formatDay(dayInTz(new Date(w.createdAt), eventTz), { day: 'numeric', month: 'short' })")
    expect(src).not.toContain("new Date(w.createdAt).toLocaleDateString(")
  })
  it('moderation queue: price in the event currency, bare date via formatDay', () => {
    const src = read('app/admin/moderation/page.tsx')
    expect(src).toContain('formatMoney(e.price, e.currency ?? cur)')
    expect(src).toContain('<span>{formatDay(e.date)}</span>')
    expect(src).not.toContain('new Date(e.date).toLocaleDateString()')
    expect(read('app/api/admin/events/approval/route.ts')).toMatch(/price: true, currency: true,/)
  })
  it('participants inbox: status pill judged on the event city calendar', () => {
    const src = read('app/admin/participants/page.tsx')
    expect(src).toContain('tz={tzFor(group.event)}')
    expect(src).toContain('const pill = eventStatusPill(event.status, event.date, tz)')
  })
})

describe('f) participants CSV neutralises spreadsheet formulas', () => {
  it('prefixes cells starting with = + - @ tab or CR with a single quote', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csvCell('+1-555')).toBe(`"'+1-555"`)
    expect(csvCell('-2+3')).toBe(`"'-2+3"`)
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(csvCell('\t=1')).toBe(`"'\t=1"`)
    expect(csvCell('\r=1')).toBe(`"'\r=1"`)
  })
  it('leaves ordinary cells alone apart from quoting', () => {
    expect(csvCell('Ayşe "Ace" Demir')).toBe('"Ayşe ""Ace"" Demir"')
    expect(csvCell('a=b')).toBe('"a=b"')
    expect(csvCell('Yes')).toBe('"Yes"')
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })
  it('toCsv applies it to every cell, header included', () => {
    expect(toCsv([['Name', 'Email'], ['=cmd', '@x.com'], ['Can', 'c@x']]))
      .toBe(`"Name","Email"\n"'=cmd","'@x.com"\n"Can","c@x"`)
  })
  it('the export builds through toCsv', () => {
    const src = read('app/admin/events/[id]/participants/page.tsx')
    expect(src).toContain('const csv = toCsv([headers, ...rows])')
    expect(src).not.toContain("r.map(v => `\"${String(v).replace(/\"/g, '\"\"')}\"`)")
  })
})
