import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  rateLimit:    vi.fn(async () => true),
  claimOnce:    vi.fn(async () => true),
  releaseClaim: vi.fn(async () => {}),
}))
vi.mock('@/lib/posthog-server', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn(async () => true) }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/memberPrivacy', () => ({
  blockedIdsFor:     vi.fn(async () => new Set<string>()),
  connectionIdsFor:  vi.fn(async () => new Set<string>()),
}))
vi.mock('@/lib/prisma', () => {
  const prisma: any = {
    event:            { findUnique: vi.fn() },
    eventAttendee:    { findMany: vi.fn() },
    eventCoHost:      { findMany: vi.fn() },
    user:             { findFirst: vi.fn(), findMany: vi.fn() },
    memberBlock:      { findFirst: vi.fn() },
    memberConnection: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    eventMeetAgain:   { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  }
  prisma.$transaction = vi.fn(async (ops: unknown[]) => Promise.all(ops))
  return { prisma }
})

import { GET, POST } from '@/app/api/events/[id]/meet-again/route'
import { DELETE as deleteConnection } from '@/app/api/connections/[id]/route'
import { resolveMutualPick, meetAgainWindow, MEET_AGAIN_MAX_PICKS } from '@/lib/meetAgain'
import { getSession } from '@/lib/session'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { blockedIdsFor, connectionIdsFor } from '@/lib/memberPrivacy'
import { prisma } from '@/lib/prisma'

const p = prisma as any
const params = { params: Promise.resolve({ id: 'e1' }) }
const post = (body: unknown) => ({ json: async () => body }) as any
const DAY = 86_400_000
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: 'e1', title: 'Film Night', date: isoDay(-2), time: '19:00', endTime: '21:00',
    hostId: 'host', status: 'published', cancelledAt: null, city: { timezone: 'Europe/Istanbul' }, ...over,
  }
}

// Room: me, a, b as attendees; host added via user.findFirst.
function room(ids = ['me', 'a', 'b']) {
  p.eventAttendee.findMany.mockResolvedValue(ids.map(userId => ({ userId })))
  p.eventCoHost.findMany.mockResolvedValue([])
  p.user.findFirst.mockResolvedValue({ id: 'host' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'me', name: 'Me Person' })
  ;(claimOnce as any).mockResolvedValue(true)
  ;(createNotification as any).mockResolvedValue(true)
  ;(blockedIdsFor as any).mockResolvedValue(new Set())
  ;(connectionIdsFor as any).mockResolvedValue(new Set())
  p.event.findUnique.mockResolvedValue(eventRow())
  p.memberConnection.findUnique.mockResolvedValue(null)
  p.memberConnection.create.mockResolvedValue({ id: 'c-new' })
  p.memberConnection.updateMany.mockResolvedValue({ count: 1 })
  p.memberConnection.deleteMany.mockResolvedValue({ count: 0 })
  p.memberBlock.findFirst.mockResolvedValue(null)
  p.eventMeetAgain.findMany.mockResolvedValue([])
  p.eventMeetAgain.deleteMany.mockResolvedValue({ count: 0 })
  p.eventMeetAgain.createMany.mockResolvedValue({ count: 0 })
  p.user.findMany.mockResolvedValue([])
  room()
})

describe('meet-again room', () => {
  it('leaves out stealth RSVPs, hidden/unapproved accounts, settled no-shows and excused', async () => {
    await GET({} as any, params)
    const where = p.eventAttendee.findMany.mock.calls[0][0].where
    expect(where.stealth).toBe(false)
    expect(where.status).toBe('approved')
    expect(where.user).toEqual({ status: 'approved', hiddenFromMembers: false })
    expect(where.NOT).toEqual(expect.arrayContaining([
      { attendance: 'no_show', event: { noShowProcessedAt: { not: null } } },
      { attendance: 'excused' },
    ]))
  })

  it('someone outside the room (incl. a stealth attendee) gets a bare "not eligible" — no event details', async () => {
    room(['a', 'b'])
    const d = await (await GET({} as any, params)).json()
    expect(d).toEqual({ eligible: false })
  })

  it.each([
    ['cancelled',  { cancelledAt: new Date() }],
    ['postponed',  { status: 'postponed' }],
    ['draft',      { status: 'draft' }],
  ])('a %s event offers nothing and refuses picks', async (_label, over) => {
    p.event.findUnique.mockResolvedValue(eventRow(over))
    expect(await (await GET({} as any, params)).json()).toEqual({ eligible: false })
    expect((await POST(post({ pickedIds: ['a'] }), params)).status).toBe(404)
    expect(p.eventMeetAgain.createMany).not.toHaveBeenCalled()
  })
})

describe('meet-again window', () => {
  it('closed before the end and after seven days', () => {
    const tz = 'Europe/Istanbul'
    expect(meetAgainWindow({ date: isoDay(1), time: '19:00', endTime: '21:00' }, tz)).toBe('too-early')
    expect(meetAgainWindow({ date: isoDay(-9), time: '19:00', endTime: '21:00' }, tz)).toBe('window-closed')
    expect(meetAgainWindow({ date: isoDay(-2), time: '19:00', endTime: '21:00' }, tz)).toBeNull()
  })

  it('POST outside the window is refused and writes nothing', async () => {
    p.event.findUnique.mockResolvedValue(eventRow({ date: isoDay(-9) }))
    const res = await POST(post({ pickedIds: ['a'] }), params)
    expect(res.status).toBe(400)
    expect(p.eventMeetAgain.createMany).not.toHaveBeenCalled()
  })
})

describe('GET meet-again — the list', () => {
  it('excludes self, blocked either way and existing connections; includes the host; returns only my own picks', async () => {
    ;(blockedIdsFor as any).mockResolvedValue(new Set(['b']))
    ;(connectionIdsFor as any).mockResolvedValue(new Set(['a']))
    p.eventMeetAgain.findMany.mockResolvedValue([{ pickedId: 'host' }, { pickedId: 'a' }])
    p.user.findMany.mockResolvedValue([{ id: 'host', name: 'Host Person', color: '#000', profilePhoto: null }])
    const d = await (await GET({} as any, params)).json()
    expect(p.user.findMany.mock.calls[0][0].where.id.in).toEqual(['host'])
    expect(d.picked).toEqual(['host'])          // 'a' is connected — not shown as a pick
    expect(p.eventMeetAgain.findMany.mock.calls[0][0].where).toEqual({ eventId: 'e1', pickerId: 'me' })
  })

  it('names are first names only, like the event roster (surnames of connections-only members are private)', async () => {
    p.user.findMany.mockResolvedValue([
      { id: 'a', name: 'Ayşe Demir', color: '#000', profilePhoto: null },
      { id: 'host', name: 'Nate Gray', color: '#111', profilePhoto: 'x.jpg' },
    ])
    const d = await (await GET({} as any, params)).json()
    expect(d.people.map((x: { name: string }) => x.name)).toEqual(['Ayşe', 'Nate'])
    expect(JSON.stringify(d)).not.toContain('Demir')
    expect(d.event).toBeUndefined()
  })
})

describe('POST meet-again — validation', () => {
  it('caps the number of picks', async () => {
    const ids = Array.from({ length: MEET_AGAIN_MAX_PICKS + 1 }, (_, i) => `u${i}`)
    expect((await POST(post({ pickedIds: ids }), params)).status).toBe(400)
  })

  it('refuses someone who was not in the room', async () => {
    expect((await POST(post({ pickedIds: ['stranger'] }), params)).status).toBe(400)
    expect(p.eventMeetAgain.createMany).not.toHaveBeenCalled()
  })

  it('refuses picking yourself', async () => {
    expect((await POST(post({ pickedIds: ['me'] }), params)).status).toBe(400)
  })

  it('a blocked member is dropped SILENTLY — same 200 as anyone else, so it is no block oracle', async () => {
    ;(blockedIdsFor as any).mockResolvedValue(new Set(['a']))
    const res = await POST(post({ pickedIds: ['a', 'b'] }), params)
    expect(res.status).toBe(200)
    expect(p.eventMeetAgain.createMany.mock.calls[0][0].data.map((r: { pickedId: string }) => r.pickedId)).toEqual(['b'])
  })

  it('an already-connected member is not stored as a pick (it would revive after an unfriend)', async () => {
    ;(connectionIdsFor as any).mockResolvedValue(new Set(['a']))
    await POST(post({ pickedIds: ['a'] }), params)
    expect(p.eventMeetAgain.createMany.mock.calls[0][0].data).toEqual([])
  })

  it('403 when the viewer was not in the room', async () => {
    room(['a', 'b'])
    expect((await POST(post({ pickedIds: ['a'] }), params)).status).toBe(403)
  })

  it('rejects a non-list body', async () => {
    expect((await POST(post({ pickedIds: 'a' }), params)).status).toBe(400)
  })
})

describe('POST meet-again — one-sided vs mutual', () => {
  it('a one-sided pick is stored and nothing else happens', async () => {
    const d = await (await POST(post({ pickedIds: ['a'] }), params)).json()
    expect(d).toEqual({ ok: true, matches: 0 })
    expect(p.eventMeetAgain.createMany).toHaveBeenCalled()
    expect(p.memberConnection.create).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('writes my picks BEFORE looking for the reverse pick (simultaneous submits still match)', async () => {
    await POST(post({ pickedIds: ['a'] }), params)
    const wrote  = p.eventMeetAgain.createMany.mock.invocationCallOrder[0]
    const looked = p.eventMeetAgain.findMany.mock.invocationCallOrder[0]
    expect(wrote).toBeLessThan(looked)
  })

  it('a mutual pick connects both and tells both — and never mentions a one-sided pick', async () => {
    p.eventMeetAgain.findMany.mockResolvedValue([{ picker: { id: 'a', name: 'Ayşe Demir' } }])
    const d = await (await POST(post({ pickedIds: ['a', 'b'] }), params)).json()
    expect(d.matches).toBe(1)
    expect(p.memberConnection.create).toHaveBeenCalledWith({
      data: { requesterId: 'me', receiverId: 'a', pairKey: 'a|me', status: 'accepted' }, select: { id: true },
    })
    const recipients = (createNotification as any).mock.calls.map((c: unknown[]) => c[0]).sort()
    expect(recipients).toEqual(['a', 'me'])
    expect(JSON.stringify((createNotification as any).mock.calls)).not.toContain('"b"')
  })

  it('clearing picks deletes them', async () => {
    await POST(post({ pickedIds: [] }), params)
    expect(p.eventMeetAgain.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'e1', pickerId: 'me', pickedId: { notIn: [] } },
    })
  })
})

describe('resolveMutualPick', () => {
  const a = { id: 'a', name: 'Ayşe Demir' }
  const b = { id: 'b', name: 'Ben Stone' }

  it('a block in either direction stops it', async () => {
    p.memberBlock.findFirst.mockResolvedValue({ id: 'blk' })
    expect(await resolveMutualPick('e1', 'Film', a, b)).toBe(false)
    expect(p.memberConnection.create).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('a block landing between the check and the write undoes the connection', async () => {
    p.memberBlock.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'blk' })
    expect(await resolveMutualPick('e1', 'Film', a, b)).toBe(false)
    expect(p.memberConnection.deleteMany).toHaveBeenCalledWith({ where: { id: 'c-new', status: 'accepted' } })
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('already connected: no-op, no notification', async () => {
    p.memberConnection.findUnique.mockResolvedValue({ id: 'c1', status: 'accepted', requesterId: 'a', receiverId: 'b' })
    expect(await resolveMutualPick('e1', 'Film', a, b)).toBe(false)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('an existing pending row becomes accepted, unaudited', async () => {
    p.memberConnection.findUnique.mockResolvedValue({ id: 'c1', status: 'pending', requesterId: 'a', receiverId: 'b' })
    expect(await resolveMutualPick('e1', 'Film', a, b)).toBe(true)
    expect(p.memberConnection.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', status: 'pending' }, data: { status: 'accepted' } })
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it('overriding a decline is audited, so the abuse history is not lost', async () => {
    p.memberConnection.findUnique.mockResolvedValue({ id: 'c1', status: 'declined', requesterId: 'a', receiverId: 'b' })
    expect(await resolveMutualPick('e1', 'Film', a, b)).toBe(true)
    expect(writeAudit).toHaveBeenCalledWith('system:meet-again', 'Meet again', 'connection.decline_overridden',
      'a', 'user', expect.objectContaining({ eventId: 'e1', requesterId: 'a', declinedBy: 'b' }), expect.any(String))
  })

  it('a concurrent resolve that got there first makes this one a quiet no-op', async () => {
    p.memberConnection.findUnique.mockResolvedValue({ id: 'c1', status: 'pending', requesterId: 'a', receiverId: 'b' })
    p.memberConnection.updateMany.mockResolvedValue({ count: 0 })
    expect(await resolveMutualPick('e1', 'Film', a, b)).toBe(false)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('losing the create race (P2002) is a no-op', async () => {
    p.memberConnection.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    expect(await resolveMutualPick('e1', 'Film', a, b)).toBe(false)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('a match spends both picks, so an unfriend cannot be silently undone by re-posting', async () => {
    await resolveMutualPick('e1', 'Film', a, b)
    expect(p.eventMeetAgain.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'e1', OR: [{ pickerId: 'a', pickedId: 'b' }, { pickerId: 'b', pickedId: 'a' }] },
    })
  })

  it('notifications are claimed per recipient per event, and a failed send hands its claim back', async () => {
    ;(createNotification as any).mockImplementation(async (to: string) => to === 'a')
    await resolveMutualPick('e1', 'Film', a, b)
    expect(claimOnce).toHaveBeenCalledWith('meet-again-match:e1:a|b:a', expect.any(Number))
    expect(claimOnce).toHaveBeenCalledWith('meet-again-match:e1:a|b:b', expect.any(Number))
    expect(releaseClaim).toHaveBeenCalledWith('meet-again-match:e1:a|b:b')
    expect(releaseClaim).toHaveBeenCalledTimes(1)
  })

  it('names the other person by first name only', async () => {
    await resolveMutualPick('e1', 'Film', a, b)
    const titles = (createNotification as any).mock.calls.map((c: unknown[]) => c[2])
    expect(titles).toContain('You and Ben both want to meet again')
    expect(titles).toContain('You and Ayşe both want to meet again')
  })
})

describe('unfriend clears meet-again picks', () => {
  it('deleting an accepted connection deletes the pair\'s picks on every event', async () => {
    p.memberConnection.findUnique.mockResolvedValue({ id: 'c1', status: 'accepted', requesterId: 'me', receiverId: 'a' })
    const res = await deleteConnection({} as any, { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    expect(p.eventMeetAgain.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ pickerId: 'me', pickedId: 'a' }, { pickerId: 'a', pickedId: 'me' }] },
    })
  })

  it('withdrawing a pending request leaves picks alone', async () => {
    p.memberConnection.findUnique.mockResolvedValue({ id: 'c1', status: 'pending', requesterId: 'me', receiverId: 'a' })
    await deleteConnection({} as any, { params: Promise.resolve({ id: 'c1' }) })
    expect(p.eventMeetAgain.deleteMany).not.toHaveBeenCalled()
  })
})
