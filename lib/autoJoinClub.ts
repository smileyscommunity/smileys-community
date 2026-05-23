import { prisma } from './prisma'

// Auto-join the club linked to an event when a member gets an approved spot.
// Safe to call multiple times — does nothing if already a member.
export async function autoJoinClub(userId: string, eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { clubId: true },
  })
  if (!event?.clubId) return

  const existing = await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId, clubId: event.clubId } },
    select: { status: true },
  })
  if (existing) return

  await prisma.clubMembership.create({
    data: { userId, clubId: event.clubId, status: 'approved' },
  })
  await prisma.club.update({
    where: { id: event.clubId },
    data: { memberCount: { increment: 1 } },
  })
}
