import { prisma } from '@/lib/prisma'
import type { Prisma, PrismaClient } from '@prisma/client'

// Callers inside an interactive transaction pass their tx client so the
// recompute commits (or rolls back) atomically with the row changes that
// made it necessary.
type Db = PrismaClient | Prisma.TransactionClient

/**
 * What spotsLeft should be for an event, derived from the attendee rows:
 *   max(0, totalSpots - approvedNonCoHostCount)
 *
 * Co-hosts (and the host) are excluded because they join for free without
 * consuming a spot.
 *
 * An event WITHOUT limited spots still carries the counter (the card derives
 * "X going" from totalSpots − spotsLeft), so past the nominal total it goes
 * negative rather than clamping — clamping would freeze "going" at the
 * total and re-open a cap the host never set.
 */
export async function expectedSpotsLeft(eventId: string, totalSpots: number, db: Db = prisma): Promise<number> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { hostId: true, limitedSpots: true } })
  const coHostIds = (await db.eventCoHost.findMany({
    where: { eventId },
    select: { userId: true },
  })).map(c => c.userId)

  const excludedIds = [...new Set([...(event?.hostId ? [event.hostId] : []), ...coHostIds])]

  const approvedCount = await db.eventAttendee.count({
    where: {
      eventId,
      status: 'approved',
      ...(excludedIds.length ? { NOT: { userId: { in: excludedIds } } } : {}),
    },
  })

  const left = totalSpots - approvedCount
  return event?.limitedSpots === false ? left : Math.max(0, left)
}

/**
 * Recomputes and persists spotsLeft for an event (see expectedSpotsLeft
 * for the formula).
 */
export async function recomputeSpotsLeft(eventId: string, totalSpots: number, db: Db = prisma): Promise<void> {
  await db.event.update({
    where: { id: eventId },
    data: { spotsLeft: await expectedSpotsLeft(eventId, totalSpots, db) },
  })
}
