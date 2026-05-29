import { prisma } from '@/lib/prisma'

/**
 * Recomputes spotsLeft for an approval-required event as:
 *   max(0, totalSpots - approvedNonCoHostCount)
 *
 * Co-hosts are excluded because they join for free without consuming a spot.
 */
export async function recomputeSpotsLeft(eventId: string, totalSpots: number): Promise<void> {
  const coHostIds = (await prisma.eventCoHost.findMany({
    where: { eventId },
    select: { userId: true },
  })).map(c => c.userId)

  const approvedCount = await prisma.eventAttendee.count({
    where: {
      eventId,
      status: 'approved',
      ...(coHostIds.length ? { NOT: { userId: { in: coHostIds } } } : {}),
    },
  })

  await prisma.event.update({
    where: { id: eventId },
    data: { spotsLeft: Math.max(0, totalSpots - approvedCount) },
  })
}
