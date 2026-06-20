import { prisma } from './prisma'
import { createNotification } from './notify'

// Auto-join the club linked to an event when a member gets an approved spot.
// Safe to call multiple times — does nothing if already a member.
// Private clubs get a pending membership instead of auto-approved so the
// club host can vet event attendees before granting full club access.
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

  const club = await prisma.club.findUnique({
    where: { id: event.clubId },
    select: { isPrivate: true, name: true, slug: true },
  })
  if (!club) return

  const status = club.isPrivate ? 'pending' : 'approved'

  await prisma.clubMembership.create({
    data: { userId, clubId: event.clubId, status },
  })

  if (!club.isPrivate) {
    await prisma.club.update({
      where: { id: event.clubId },
      data: { memberCount: { increment: 1 } },
    })
  } else {
    const [requester, hosts] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.clubMembership.findMany({
        where: { clubId: event.clubId, role: 'host', status: 'approved' },
        select: { userId: true },
      }),
    ])
    await Promise.all(hosts.map(h =>
      createNotification(h.userId, 'club_approved', 'New join request',
        `${requester?.name ?? 'A member'} wants to join "${club.name}" (via event)`, `/host/clubs/${club.slug}`)
    ))
  }
}
