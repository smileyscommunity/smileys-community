import { prisma } from '@/lib/prisma'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { createNotification } from '@/lib/notify'
import { backfillSeatPayments } from '@/lib/rsvpConfirmed'
import { lockEventRow, seatState } from '@/lib/eventCapacity'

// Cancelling an event releases every seat and pending request as removed by
// staff, stamped at the event's own cancelledAt (app/api/admin/events/[id]).
// Restoring the event used to clear that stamp and nothing else, so it came
// back live with every member who held a spot gone — after they had already
// been told it was cancelled.
//
// This puts back exactly the rows the cancel released: removed by an admin or
// host no earlier than the event's cancellation stamp and within a minute of
// it (cancels before 2026-09-13 stamped the two a few milliseconds apart).
// A member's own cancel, and any removal from before the event was cancelled,
// stay as they are.
//
// A removed row doesn't record what it was before. On an event without an
// approval step every active row was an approved seat, so they come back
// approved. On an approval-required event a pending request and an approved
// seat look the same once removed, so they come back as requests for the host
// to approve again — nobody ends up seated who wasn't vetted. The waitlist was
// deleted by the cancel and can't be rebuilt.
//
// On a limited event seats come back only up to the cap: totalSpots can be
// lowered while the event sits cancelled, and restoring every seat regardless
// put it over capacity. Those who don't fit go onto the waitlist in the order
// they joined, and are told so — nobody is seated past the cap, nobody dropped.
export const RESTORE_WINDOW_MS = 60_000

export interface RestorableEvent {
  id:               string
  title:            string
  totalSpots:       number
  limitedSpots?:    boolean
  approvalRequired: boolean
  cancelledAt:      Date | null
}

type ReleasedRow = { id: string; userId: string }

/**
 * Pure: which released rows get their seat back and which go to the waitlist.
 * Rows arrive in joined order. Staff (host, co-hosts) take no seat, so they
 * always come back and never use up room.
 */
export function splitRestoredSeats<T extends ReleasedRow>(rows: T[], cap: { totalSpots: number; approved: number; staffIds: string[] }): { seated: T[]; overflow: T[] } {
  const staff = new Set(cap.staffIds)
  let room = Math.max(0, cap.totalSpots - cap.approved)
  const seated: T[] = []
  const overflow: T[] = []
  for (const r of rows) {
    if (staff.has(r.userId)) seated.push(r)
    else if (room > 0) { seated.push(r); room-- }
    else overflow.push(r)
  }
  return { seated, overflow }
}

export async function restoreSeatsReleasedByCancel(ev: RestorableEvent): Promise<{ restored: number; status: 'approved' | 'pending' | null; waitlisted?: number }> {
  if (!ev.cancelledAt) return { restored: 0, status: null }
  const rows = await prisma.eventAttendee.findMany({
    where: {
      eventId:     ev.id,
      status:      'removed',
      cancelledBy: { in: ['admin', 'host'] },
      cancelledAt: { gte: ev.cancelledAt, lte: new Date(ev.cancelledAt.getTime() + RESTORE_WINDOW_MS) },
    },
    select:  { id: true, userId: true },
    orderBy: { joinedAt: 'asc' },
  })
  if (rows.length === 0) return { restored: 0, status: null }

  const status = ev.approvalRequired ? 'pending' : 'approved'
  const revive = { status, cancelledAt: null, cancelledBy: null }
  let seated: ReleasedRow[] = rows
  let overflow: ReleasedRow[] = []
  if (status === 'approved' && ev.limitedSpots) {
    // Counted and written under the event's row lock, like every other seat.
    ;({ seated, overflow } = await prisma.$transaction(async tx => {
      await lockEventRow(tx, ev.id)
      const seats = await seatState(tx, ev.id, { countEvenIfUnlimited: true })
      const totalSpots = seats?.totalSpots ?? ev.totalSpots
      const split = splitRestoredSeats(rows, { totalSpots, approved: seats?.approved ?? 0, staffIds: seats?.staffIds ?? [] })
      if (split.seated.length) {
        await tx.eventAttendee.updateMany({ where: { id: { in: split.seated.map(r => r.id) }, status: 'removed' }, data: revive })
      }
      for (const r of split.overflow) {
        await tx.waitlistEntry.upsert({
          where:  { userId_eventId: { userId: r.userId, eventId: ev.id } },
          create: { userId: r.userId, eventId: ev.id },
          update: {},
        })
      }
      await recomputeSpotsLeft(ev.id, totalSpots, tx)
      return split
    }))
  } else {
    await prisma.eventAttendee.updateMany({
      where: { id: { in: rows.map(r => r.id) }, status: 'removed' },
      data:  revive,
    })
    await recomputeSpotsLeft(ev.id, ev.totalSpots)
  }

  // A seat that comes back approved owes what it owed before. The cancel left
  // the ledger alone, but a row voided in the meantime (or never written) would
  // otherwise bring the seat back free. Idempotent; a failure here must not
  // cost members the "back on" notice below.
  if (status === 'approved' && seated.length > 0) {
    await backfillSeatPayments(ev.id).catch(err =>
      console.error('[eventRestore] seat payment backfill failed', { eventId: ev.id, err: String(err) }))
  }

  for (const r of seated) {
    createNotification(r.userId, 'event_updated',
      'Event is back on 🎉',
      status === 'approved'
        ? `"${ev.title}" is back on, and your spot is restored.`
        : `"${ev.title}" is back on — your request is with the host again.`,
      `/events/${ev.id}`,
    ).catch(() => {})
  }
  for (const r of overflow) {
    createNotification(r.userId, 'event_updated',
      'Event is back on 🎉',
      `"${ev.title}" is back on, but it has fewer spots now — you're on the waitlist and we'll tell you if one opens.`,
      `/events/${ev.id}`,
    ).catch(() => {})
  }
  return { restored: seated.length, status, ...(overflow.length ? { waitlisted: overflow.length } : {}) }
}
