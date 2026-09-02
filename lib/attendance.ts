import type { Prisma, PrismaClient } from '@prisma/client'
import { AttendeeStatus, Attendance } from '@/lib/constants'

// Callers inside an interactive transaction pass their tx client so the
// attendee write commits (or rolls back) with the spot change it belongs to.
type Db = PrismaClient | Prisma.TransactionClient

// ── Soft-cancel attendee rows ──────────────────────────────────────────────
//
// An RSVP used to be a row that existed or didn't: cancelling deleted it.
// That left no trace of WHEN the spot was given back, which is the fact a
// no-show policy turns on ("cancelled in time" vs "just didn't come"). Now
// the row stays and `status` says what happened. The cost is that "a row
// exists" no longer means "is attending" — every such read filters on the
// active statuses below, and every join path goes through activateAttendee
// so a revived row and a fresh one look the same to the rest of the app.

/** Holds or is asking for a spot. Anything else is history. */
export const ACTIVE_ATTENDEE_STATUSES: string[] = [AttendeeStatus.Approved, AttendeeStatus.Pending]

/** Spread into a `where` to mean "currently attending or pending". */
export const activeAttendeeWhere = { status: { in: ACTIVE_ATTENDEE_STATUSES } }

export function isActiveAttendee(row: { status: string } | null | undefined): row is { status: string } {
  return !!row && ACTIVE_ATTENDEE_STATUSES.includes(row.status)
}

export type CancelActor = 'member' | 'host' | 'admin' | 'system'   // system: reconfirmation release

/**
 * Put a member on an event: a fresh row, or the revival of one that was
 * cancelled or removed earlier. (userId, eventId) is unique, so a plain
 * create throws P2002 the second time round — this is the one door every
 * join path uses.
 *
 * Revival resets the door-side state (joinedAt, checkedIn, stealth,
 * attendance): a re-RSVP is a new commitment, not a resumed one. An ACTIVE
 * row is deliberately not touched — the create below throws on it exactly
 * as it always did, so a racing double-join still rolls its transaction
 * back instead of silently claiming two spots for one person.
 */
export async function activateAttendee(
  db: Db,
  args: { userId: string; eventId: string; status: 'approved' | 'pending'; stealth?: boolean },
): Promise<void> {
  const { userId, eventId, status, stealth = false } = args
  const revived = await db.eventAttendee.updateMany({
    where: { userId, eventId, status: { in: [AttendeeStatus.Cancelled, AttendeeStatus.Removed] } },
    data:  {
      status, stealth,
      joinedAt:    new Date(),
      checkedIn:   false,
      attendance:  Attendance.Unknown,
      cancelledAt: null,
      cancelledBy: null,
      // A fresh commitment gets a fresh day-before ask. Without this a
      // member released for not answering, who then rejoins, is released
      // again on the next run — every hour until the start.
      reconfirmAskedAt: null,
      reconfirmedAt:    null,
    },
  })
  if (revived.count === 0) {
    await db.eventAttendee.create({ data: { userId, eventId, status, stealth } })
  }
}

/**
 * Take a member off an event without losing the row. Returns the
 * PrismaPromise so it slots into array-style `$transaction([...])` calls
 * next to the payment bookkeeping that usually accompanies it. Only an
 * active row changes; cancelling twice is a no-op (count 0), never a
 * rewrite of the first cancellation's timestamp.
 */
export function cancelAttendeeOp(
  db: Db,
  args: { userId: string; eventId: string; by: CancelActor },
) {
  const status = args.by === 'member' ? AttendeeStatus.Cancelled : AttendeeStatus.Removed
  return db.eventAttendee.updateMany({
    where: { userId: args.userId, eventId: args.eventId, ...activeAttendeeWhere },
    data:  { status, cancelledAt: new Date(), cancelledBy: args.by },
  })
}
