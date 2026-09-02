import { describe, it, expect, vi, beforeEach } from 'vitest'
import { activateAttendee, cancelAttendeeOp, isActiveAttendee, activeAttendeeWhere } from '@/lib/attendance'

// Attendee rows used to be deleted on cancel. Now they stay, so "a row
// exists" stopped meaning "is attending" — these pin the three rules that
// keep that from leaking: which statuses count, how a revival differs from
// a fresh join, and that cancelling twice never rewrites the first stamp.

const db = () => ({
  eventAttendee: {
    updateMany: vi.fn(),
    create:     vi.fn(),
  },
}) as any

beforeEach(() => vi.clearAllMocks())

describe('isActiveAttendee', () => {
  it('counts approved and pending, nothing else', () => {
    expect(isActiveAttendee({ status: 'approved' })).toBe(true)
    expect(isActiveAttendee({ status: 'pending' })).toBe(true)
    expect(isActiveAttendee({ status: 'cancelled' })).toBe(false)
    expect(isActiveAttendee({ status: 'removed' })).toBe(false)
    expect(isActiveAttendee(null)).toBe(false)
    expect(isActiveAttendee(undefined)).toBe(false)
  })

  it('the where fragment says the same thing', () => {
    expect(activeAttendeeWhere).toEqual({ status: { in: ['approved', 'pending'] } })
  })
})

describe('activateAttendee', () => {
  it('creates a fresh row when there is nothing to revive', async () => {
    const d = db()
    d.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
    await activateAttendee(d, { userId: 'u1', eventId: 'e1', status: 'approved', stealth: true })
    expect(d.eventAttendee.create).toHaveBeenCalledWith({
      data: { userId: 'u1', eventId: 'e1', status: 'approved', stealth: true },
    })
  })

  it('revives a cancelled/removed row as a new commitment and does not create', async () => {
    const d = db()
    d.eventAttendee.updateMany.mockResolvedValue({ count: 1 })
    await activateAttendee(d, { userId: 'u1', eventId: 'e1', status: 'pending' })
    const call = d.eventAttendee.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ userId: 'u1', eventId: 'e1', status: { in: ['cancelled', 'removed'] } })
    expect(call.data).toMatchObject({
      status: 'pending', stealth: false, checkedIn: false, attendance: 'unknown',
      cancelledAt: null, cancelledBy: null,
      reconfirmAskedAt: null, reconfirmedAt: null,   // a rejoin is a fresh ask, not a stale release
    })
    expect(call.data.joinedAt).toBeInstanceOf(Date)
    expect(d.eventAttendee.create).not.toHaveBeenCalled()
  })

  it('never revives an ACTIVE row — the create is left to throw on the unique key', async () => {
    // A racing double-join used to fail on P2002 and roll back; a blanket
    // upsert would have silently let both requests claim a spot.
    const d = db()
    d.eventAttendee.updateMany.mockResolvedValue({ count: 0 })
    d.eventAttendee.create.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
    await expect(activateAttendee(d, { userId: 'u1', eventId: 'e1', status: 'approved' })).rejects.toMatchObject({ code: 'P2002' })
  })
})

describe('cancelAttendeeOp', () => {
  it("stamps 'cancelled' for the member and 'removed' for a host or admin", () => {
    for (const [by, status] of [['member', 'cancelled'], ['host', 'removed'], ['admin', 'removed']] as const) {
      const d = db()
      cancelAttendeeOp(d, { userId: 'u1', eventId: 'e1', by })
      const call = d.eventAttendee.updateMany.mock.calls[0][0]
      expect(call.data).toMatchObject({ status, cancelledBy: by })
      expect(call.data.cancelledAt).toBeInstanceOf(Date)
    }
  })

  it('only touches an active row, so a second cancel keeps the first timestamp', () => {
    const d = db()
    cancelAttendeeOp(d, { userId: 'u1', eventId: 'e1', by: 'member' })
    expect(d.eventAttendee.updateMany.mock.calls[0][0].where)
      .toEqual({ userId: 'u1', eventId: 'e1', status: { in: ['approved', 'pending'] } })
  })
})
