import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

// Scan 5, items 95–96 (2026-09 production data audit).
//
//  95. Duplicating an event spread the source row into the copy, sweep stamps
//      included — a copy of a finished event carried noShowProcessedAt and
//      surveyDispatchedAt, so its no-show settlement and survey were silently
//      skipped. The copy is now built from an explicit allow-list, and a
//      ratchet below fails when the Event model grows an unclassified column.
//  96. Free-text times were stored verbatim ('22.00', '18', '24:00') and read as
//      ending 23:59. One normaliser now guards every create/update, and the
//      reader tolerates the legacy forms until the repair script has run.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit',   () => ({ writeAudit: vi.fn(async () => {}), getDiff: vi.fn(() => null) }))
vi.mock('@/lib/notify',  () => ({ createNotification: vi.fn(async () => {}), notifyNewEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/email',   () => ({ sendEventCancelledEmail: vi.fn(), recordEmailFailure: vi.fn() }))
vi.mock('@/lib/spotsLeft', () => ({ recomputeSpotsLeft: vi.fn(async () => {}) }))
vi.mock('@/lib/venueDirectory', () => ({ ensurePendingVenueBusiness: vi.fn(async () => {}) }))
vi.mock('@/lib/survey', () => ({ computeEventSurveyRollup: vi.fn(async () => new Map()) }))
vi.mock('@/lib/city', () => ({
  todayInCity:         vi.fn(async () => '2026-09-14'),
  resolveCityId:       vi.fn(async () => 'c-viewer'),
  getCityConfig:       vi.fn(async () => ({ currency: 'TRY' })),
  resolveTargetCityId: vi.fn(async () => ({ cityId: 'c1' })),
}))
vi.mock('@/lib/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access')>()),
  isClubHost:    vi.fn(async () => false),
  isClubHostFor: vi.fn(async () => true),
  hostCityIds:   vi.fn(async () => []),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction:  vi.fn(async (ops: any) => Promise.all(ops)),
    club:          { findUnique: vi.fn(async () => ({ cityId: 'c1', name: 'Club' })) },
    tag:           { findMany: vi.fn(async () => []) },
    user:          { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    event: {
      findUnique: vi.fn(),
      create:     vi.fn(async ({ data }: any) => ({ id: 'copy1', ...data })),
      update:     vi.fn(async ({ data }: any) => ({ id: 'e1', totalSpots: 10, ...data })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      count:      vi.fn(async () => 0),
    },
    eventAttendee: { findMany: vi.fn(async () => []) },
  },
}))

import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { todayInCity } from '@/lib/city'
import { normalizeClock, eventTimeInput, eventEndsAt, eventStartsAt, eventPhase } from '@/lib/eventTime'
import { DUPLICATE_COPIED_FIELDS, DUPLICATE_RESET_FIELDS } from '@/lib/eventDuplicate'
import { planStampRepair, type StampedEventRow } from '@/scripts/repair-duplicated-event-stamps'
import { planTimeRepair } from '@/scripts/repair-malformed-event-times'

const admin = { id: 'a1', name: 'Adm', email: 'a@x', role: 'admin', color: '#000', cityId: 'c1' }
const IST = 'Europe/Istanbul'   // UTC+3, no DST
const params = { params: Promise.resolve({ id: 'e1' }) } as never
const req = (body: unknown) => ({ json: async () => body, nextUrl: new URL('https://x/api') }) as never

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(admin)
})

// ── 95. duplicate ────────────────────────────────────────────────────────────

describe('duplicating an event', () => {
  const stamp = new Date('2026-08-01T20:00:00Z')
  const source = {
    id: 'e1', createdAt: stamp, updatedAt: stamp,
    title: 'Sunset Walk', description: 'd', date: '2026-07-30', time: '19:00', endTime: '22.00', duration: 180,
    location: 'Moda', neighborhood: 'Kadıköy', address: 'a', lat: 1, lng: 2,
    emoji: '🌅', coverImage: null, coverImagePosition: 50, vibes: ['chill'], intent: 'social', language: null, difficulty: null,
    price: 0, memberPrice: null, currency: 'TRY', payTo: 'venue', paymentContact: null, ticketUrl: null, refundPolicy: null,
    totalSpots: 12, spotsLeft: 0, limitedSpots: true, soldOut: true, approvalRequired: false,
    isPremium: false, membersOnly: false, isFirstTimerFriendly: true, featured: true,
    minAge: null, maxAge: null, genderBalance: false, maleQuota: null, femaleQuota: null, turkishMaleQuota: null,
    meetingUrl: null, whatsappUrl: null, clubId: 'club1', hostId: 'h1', cityId: 'c-antalya',
    status: 'archived', seriesId: 's1', isRecurring: true, registrationDeadline: '2026-07-29',
    cancelledAt: stamp, cancelReason: 'rain',
    // Every sweep stamp the source's life earned.
    surveyDispatchedAt: stamp, surveyReminderAt: stamp, noShowProcessedAt: stamp,
  }

  it('the copy carries no sweep stamps, even when the source has all of them', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(source)
    const { POST } = await import('@/app/api/admin/events/[id]/duplicate/route')
    const res = await POST(req({}), params)
    expect(res.status).toBe(200)
    const data = (prisma.event.create as any).mock.calls[0][0].data
    expect(data.noShowProcessedAt).toBeNull()
    expect(data.surveyDispatchedAt).toBeNull()
    expect(data.surveyReminderAt).toBeNull()
    expect(data.cancelledAt).toBeNull()
    expect(data).toMatchObject({
      title: 'Sunset Walk (Copy)', status: 'draft', spotsLeft: 12, soldOut: false, featured: false,
      seriesId: null, isRecurring: false, registrationDeadline: null, cancelReason: null,
      date: '2026-09-14', endTime: '22:00', description: 'd', cityId: 'c-antalya', hostId: 'h1',
    })
    // Never the source's id, and nothing outside the two classified lists.
    expect(data.id).toBeUndefined()
    const known = new Set<string>([...DUPLICATE_COPIED_FIELDS, ...DUPLICATE_RESET_FIELDS])
    expect(Object.keys(data).filter(k => !known.has(k))).toEqual([])
    // "Today" is the copy's own city's, not the viewer's.
    expect(todayInCity).toHaveBeenCalledWith('c-antalya')
  })

  it('every Event column is classified as copied or reset — a new stamp cannot ride along unnoticed', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    const body   = schema.match(/^model Event \{([\s\S]*?)^\}/m)![1]
    const SCALAR = /^(String|Int|Float|Boolean|DateTime|Json|Decimal|BigInt)(\?|\[\])?$/
    const columns = body.split('\n')
      .map(l => l.trim().split(/\s+/))
      .filter(([name, type]) => name && !name.startsWith('//') && !name.startsWith('@@') && type && SCALAR.test(type))
      .map(([name]) => name)
    const copied = new Set<string>(DUPLICATE_COPIED_FIELDS)
    const reset  = new Set<string>(DUPLICATE_RESET_FIELDS)
    expect([...copied].filter(f => reset.has(f))).toEqual([])
    expect(columns.filter(c => !copied.has(c) && !reset.has(c))).toEqual([])
    expect([...copied, ...reset].filter(f => !columns.includes(f))).toEqual([])
  })
})

// ── 96. time normaliser ──────────────────────────────────────────────────────

describe('normalizeClock', () => {
  it.each([
    ['19:30', '19:30'], ['9:30', '09:30'], ['22.00', '22:00'], ['7.15', '07:15'],
    ['2230', '22:30'], ['18', '18:00'], ['9', '09:00'], [' 21:00 ', '21:00'], ['00:00', '00:00'],
    // Live rows from the Sept 2026 dry run: space and h/H separators.
    ['23 30', '23:30'], ['23 00', '23:00'], ['21h45', '21:45'], ['21H45', '21:45'], ['9h05', '09:05'],
  ])('%j → %j', (raw, want) => {
    expect(normalizeClock(raw, 'start')).toBe(want)
    expect(normalizeClock(raw, 'end')).toBe(want)
  })

  it('reads 24:00 as end of day (23:59) for an end, and rejects it as a start', () => {
    for (const raw of ['24:00', '24', '24.00', '2400']) {
      expect(normalizeClock(raw, 'end')).toBe('23:59')
      expect(normalizeClock(raw, 'start')).toBeNull()
    }
  })

  it.each(['late', '25:00', '19:60', '7pm', '19:00 - 22:00', '123', '', '24:30', ':30', '21h', 'h45', '23  30x', '21h4'])('rejects %j', raw => {
    expect(normalizeClock(raw, 'end')).toBeNull()
  })
})

describe('eventTimeInput', () => {
  it('normalises, keeps TBA as a start, clears a blank end, requires a start', () => {
    expect(eventTimeInput('22.00', 'end')).toEqual({ value: '22:00' })
    expect(eventTimeInput('tba', 'start')).toEqual({ value: 'TBA' })
    expect(eventTimeInput('', 'end')).toEqual({ value: null })
    expect(eventTimeInput(':00', 'end')).toEqual({ value: null })   // the admin form's unpicked hour
    expect(eventTimeInput(undefined, 'end')).toEqual({ value: null })
    expect(eventTimeInput('', 'start')).toEqual({ error: 'Start time is required' })
    expect(eventTimeInput('TBA', 'end')).toHaveProperty('error')
  })

  it('names the field and the bad value in the 400 message', () => {
    const r = eventTimeInput('late', 'end') as { error: string }
    expect(r.error).toMatch(/End time "late"/)
    expect(r.error).toMatch(/HH:MM/)
  })
})

describe('eventTime reads legacy stored forms', () => {
  const at = (date: string, endTime: string | null, time: string | null = '19:00') => eventEndsAt({ date, time, endTime }, IST).toISOString()

  it("'22.00', '18' and '2230' end when they say, not at 23:59", () => {
    expect(at('2026-09-12', '22.00')).toBe('2026-09-12T19:00:00.000Z')
    expect(at('2026-09-12', '21')).toBe('2026-09-12T18:00:00.000Z')
    expect(at('2026-09-12', '2230')).toBe('2026-09-12T19:30:00.000Z')
  })

  it("'24:00' is end of day", () => {
    expect(at('2026-09-12', '24:00')).toBe('2026-09-12T20:59:00.000Z')
  })

  it('the old prefix reads still work, and garbage still falls back to 23:59', () => {
    expect(at('2026-09-12', '22:30:00')).toBe('2026-09-12T19:30:00.000Z')
    expect(at('2026-09-12', 'late')).toBe('2026-09-12T20:59:00.000Z')
    expect(at('2026-09-12', '25:00')).toBe('2026-09-12T20:59:00.000Z')
  })

  it('a legacy start time reads as a start, for the start and the live banner', () => {
    expect(eventStartsAt({ date: '2026-09-12', time: '19.00' }, IST).toISOString()).toBe('2026-09-12T16:00:00.000Z')
    expect(eventPhase({ date: '2026-09-12', time: '19.00', endTime: '22.00' }, IST, new Date('2026-09-12T17:00:00Z'))).toBe('live')
    // A '24:00' start is not a start at all — no banner, as for TBA.
    expect(eventPhase({ date: '2026-09-12', time: '24:00', endTime: null }, IST, new Date('2026-09-12T17:00:00Z'))).toBeNull()
  })
})

describe('create route validates times', () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    title: 'Walk', date: '2026-10-20', time: '19:00', location: 'Moda', neighborhood: 'Kadıköy',
    clubId: 'club1', hostId: 'a1', description: 'x', totalSpots: 20, price: '0', memberPrice: '', ...over,
  })
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/admin/events/route')
    return POST(req(body))
  }

  it('400s an unreadable end time without creating anything', async () => {
    const res = await post(payload({ endTime: 'late' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/End time/)
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it('400s an impossible start time', async () => {
    const res = await post(payload({ time: '25:00' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Start time/)
  })

  it('stores the normalised values', async () => {
    const res = await post(payload({ time: '19.30', endTime: '24:00' }))
    expect(res.status).toBe(200)
    const data = (prisma.event.create as any).mock.calls[0][0].data
    expect(data.time).toBe('19:30')
    expect(data.endTime).toBe('23:59')
  })
})

describe('update route validates times', () => {
  const before = (over: Record<string, unknown> = {}) => ({
    hostId: 'h1', clubId: 'club1', cityId: 'c1', date: '2026-10-01', time: '19:00', endTime: null,
    location: 'x', title: 'T', neighborhood: 'x', price: 0, memberPrice: null, totalSpots: 10,
    emoji: '🎉', isPremium: false, membersOnly: false, limitedSpots: false, isFirstTimerFriendly: false,
    status: 'published', seriesId: null, cancelledAt: null, approvalRequired: false, ...over,
  })
  const put = async (body: unknown) => {
    const { PUT } = await import('@/app/api/admin/events/[id]/route')
    return PUT(req(body), params)
  }

  it('400s an unreadable time the caller is setting', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(before())
    const res = await put({ endTime: '10pm' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/End time "10pm"/)
    const res2 = await put({ time: '' })
    expect(res2.status).toBe(400)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it('normalises what it stores, and a blank end clears it', async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(before())
    expect((await put({ time: '20.15', endTime: '2300' })).status).toBe(200)
    expect((prisma.event.update as any).mock.calls[0][0].data).toMatchObject({ time: '20:15', endTime: '23:00' })
    expect((await put({ endTime: '' })).status).toBe(200)
    expect((prisma.event.update as any).mock.calls[1][0].data.endTime).toBeNull()
  })

  it("an old row's unparseable value sent back unchanged doesn't block an unrelated edit", async () => {
    ;(prisma.event.findUnique as any).mockResolvedValue(before({ endTime: '19:00 - 22:00' }))
    const res = await put({ title: 'New title', endTime: '19:00 - 22:00' })
    expect(res.status).toBe(200)
    const data = (prisma.event.update as any).mock.calls[0][0].data
    expect(data.title).toBe('New title')
    expect('endTime' in data).toBe(false)
  })
})

// ── repair script planners ───────────────────────────────────────────────────

describe('planStampRepair', () => {
  const created = new Date('2026-09-01T10:00:00Z')
  const older   = new Date('2026-08-20T10:00:00Z')
  const newer   = new Date('2026-09-05T10:00:00Z')
  const row = (over: Partial<StampedEventRow> = {}): StampedEventRow => ({
    id: 'e1', title: 'Copy', date: '2026-09-20', cityId: 'c1', createdAt: created,
    noShowProcessedAt: null, surveyDispatchedAt: null, surveyReminderAt: null, noShowCards: 0, surveys: 0, ...over,
  })
  const today = () => '2026-09-14'

  it('clears stamps older than the row on an upcoming event', () => {
    const [p] = planStampRepair([row({ noShowProcessedAt: older, surveyDispatchedAt: older, surveyReminderAt: older })], today)
    expect(p.clear.map(c => c.stamp)).toEqual(['noShowProcessedAt', 'surveyDispatchedAt', 'surveyReminderAt'])
    expect(p.keep).toEqual([])
    expect(p.today).toBe('2026-09-14')
  })

  it('counts an event on today as upcoming, and ignores past events', () => {
    expect(planStampRepair([row({ date: '2026-09-14', noShowProcessedAt: older })], today)).toHaveLength(1)
    expect(planStampRepair([row({ date: '2026-09-13', noShowProcessedAt: older })], today)).toEqual([])
  })

  it('leaves a stamp written after the row existed (date moved), or one with cards/surveys behind it', () => {
    const [a] = planStampRepair([row({ noShowProcessedAt: newer })], today)
    expect(a.clear).toEqual([])
    expect(a.keep[0].why).toMatch(/after the row was created/)
    const [b] = planStampRepair([row({ noShowProcessedAt: older, surveyDispatchedAt: older, noShowCards: 2, surveys: 0 })], today)
    expect(b.keep.map(k => k.stamp)).toEqual(['noShowProcessedAt'])
    expect(b.clear.map(c => c.stamp)).toEqual(['surveyDispatchedAt'])
  })

  it('uses each event\'s own city day', () => {
    const byCity = (c: string) => (c === 'c-west' ? '2026-09-13' : '2026-09-14')
    expect(planStampRepair([row({ cityId: 'c-west', date: '2026-09-13', surveyDispatchedAt: older })], byCity)).toHaveLength(1)
  })
})

describe('planTimeRepair', () => {
  const r = (time: string, endTime: string | null) => ({ id: 'e1', title: 'T', date: '2026-09-01', time, endTime })

  it('proposes the normalised value for each malformed field, and UNFIXABLE otherwise', () => {
    const fixes = planTimeRepair([r('19:00', '22.00'), r('18', '24:00'), r('24:00', 'late'), r('19:00', '')])
    expect(fixes.map(f => [f.field, f.old, f.proposed])).toEqual([
      ['endTime', '22.00', '22:00'],
      ['time',    '18',    '18:00'],
      ['endTime', '24:00', '23:59'],
      ['time',    '24:00', 'UNFIXABLE'],
      ['endTime', 'late',  'UNFIXABLE'],
      ['endTime', '',      null],
    ])
  })

  it('skips strict rows, null ends and TBA starts', () => {
    expect(planTimeRepair([r('19:00', '22:00'), r('09:05', null), r('TBA', null)])).toEqual([])
  })
})
