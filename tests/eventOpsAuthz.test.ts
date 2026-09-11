import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/access',    () => ({ canManageEventOps: vi.fn(), isAdmin: (s: any) => s?.role === 'admin' }))
vi.mock('@/lib/city',      () => ({ getCityTz: vi.fn().mockResolvedValue('Europe/Istanbul') }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  event:         { findUnique: vi.fn() },
  eventAttendee: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  eventMessage:  { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
} }))

import { POST as broadcast } from '@/app/api/host/events/[id]/broadcast/route'
import { DELETE as deleteMessage } from '@/app/api/events/[id]/messages/route'
import { getSession } from '@/lib/session'
import { canManageEventOps } from '@/lib/access'
import { prisma } from '@/lib/prisma'

// Two participant ops that had their own, narrower idea of who runs an event.
// Every sibling route (check-in, approve, promote) uses canManageEventOps,
// which includes co-hosts and club hosts; broadcast checked host-or-club-host
// only, and message deletion required an attendee row the host never has.

const p = prisma as any
const req = (body: any = {}) => ({ json: async () => body }) as any
const cohost = { id: 'ch', name: 'Co', role: 'member' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(cohost)
  p.event.findUnique.mockResolvedValue({ id: 'e1', title: 'T', hostId: 'h1', clubId: null })
})

describe('POST /host/events/[id]/broadcast', () => {
  const params = { params: Promise.resolve({ id: 'e1' }) }
  it('lets anyone canManageEventOps approves send', async () => {
    ;(canManageEventOps as any).mockResolvedValue(true)
    const res = await broadcast(req({ message: 'Doors at 7' }), params)
    expect(res.status).toBe(200)
    expect(canManageEventOps).toHaveBeenCalledWith('ch', 'member', 'e1')
  })
  it('refuses everyone else', async () => {
    ;(canManageEventOps as any).mockResolvedValue(false)
    const res = await broadcast(req({ message: 'Doors at 7' }), params)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /events/[id]/messages', () => {
  const params = { params: Promise.resolve({ id: 'e1', messageId: 'm1' }) }
  it('lets a co-host with no attendee row delete their own message', async () => {
    ;(canManageEventOps as any).mockResolvedValue(true)
    p.eventAttendee.findUnique.mockResolvedValue(null)
    p.eventMessage.findUnique.mockResolvedValue({ id: 'm1', eventId: 'e1', userId: 'ch' })
    const res = await deleteMessage(req({ messageId: 'm1' }), params)
    expect(res.status).toBe(200)
    expect(p.eventMessage.delete).toHaveBeenCalled()
  })
  it('still does not let them delete someone else\'s message', async () => {
    ;(canManageEventOps as any).mockResolvedValue(true)
    p.eventAttendee.findUnique.mockResolvedValue(null)
    p.eventMessage.findUnique.mockResolvedValue({ id: 'm1', eventId: 'e1', userId: 'other' })
    const res = await deleteMessage(req({ messageId: 'm1' }), params)
    expect(res.status).toBe(403)
    expect(p.eventMessage.delete).not.toHaveBeenCalled()
  })
  it('a non-attendee non-staff member is refused', async () => {
    ;(canManageEventOps as any).mockResolvedValue(false)
    p.eventAttendee.findUnique.mockResolvedValue(null)
    p.eventMessage.findUnique.mockResolvedValue({ id: 'm1', eventId: 'e1', userId: 'ch' })
    const res = await deleteMessage(req({ messageId: 'm1' }), params)
    expect(res.status).toBe(403)
  })
})
