import { prisma } from '@/lib/prisma'

/**
 * Recomputes spotsLeft for an approval-required event as:
 *   max(0, totalSpots - approvedNonCoHostCount)
 *
 * Co-hosts are excluded because they join for free without consuming a spot.
 */
export async function recomputeSpotsLeft(eventId: string, totalSpots: number): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { hostId: true } })
  const coHostIds = (await prisma.eventCoHost.findMany({
    where: { eventId },
    select: { userId: true },
  })).map(c => c.userId)

  const excludedIds = [...new Set([...(event?.hostId ? [event.hostId] : []), ...coHostIds])]

  const approvedCount = await prisma.eventAttendee.count({
    where: {
      eventId,
      status: 'approved',
      ...(excludedIds.length ? { NOT: { userId: { in: excludedIds } } } : {}),
    },
  })

  await prisma.event.update({
    where: { id: eventId },
    data: { spotsLeft: Math.max(0, totalSpots - approvedCount) },
  })
}
