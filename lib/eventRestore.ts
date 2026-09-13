import { prisma } from '@/lib/prisma'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { createNotification } from '@/lib/notify'

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
export const RESTORE_WINDOW_MS = 60_000

export interface RestorableEvent {
  id:               string
  title:            string
  totalSpots:       number
  approvalRequired: boolean
  cancelledAt:      Date | null
}

export async function restoreSeatsReleasedByCancel(ev: RestorableEvent): Promise<{ restored: number; status: 'approved' | 'pending' | null }> {
  if (!ev.cancelledAt) return { restored: 0, status: null }
  const rows = await prisma.eventAttendee.findMany({
    where: {
      eventId:     ev.id,
      status:      'removed',
      cancelledBy: { in: ['admin', 'host'] },
      cancelledAt: { gte: ev.cancelledAt, lte: new Date(ev.cancelledAt.getTime() + RESTORE_WINDOW_MS) },
    },
    select: { id: true, userId: true },
  })
  if (rows.length === 0) return { restored: 0, status: null }

  const status = ev.approvalRequired ? 'pending' : 'approved'
  await prisma.eventAttendee.updateMany({
    where: { id: { in: rows.map(r => r.id) }, status: 'removed' },
    data:  { status, cancelledAt: null, cancelledBy: null },
  })
  await recomputeSpotsLeft(ev.id, ev.totalSpots)

  for (const r of rows) {
    createNotification(r.userId, 'event_updated',
      'Event is back on 🎉',
      status === 'approved'
        ? `"${ev.title}" is back on, and your spot is restored.`
        : `"${ev.title}" is back on — your request is with the host again.`,
      `/events/${ev.id}`,
    ).catch(() => {})
  }
  return { restored: rows.length, status }
}
