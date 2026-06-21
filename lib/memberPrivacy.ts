import { prisma } from '@/lib/prisma'
import { isAdminOrModerator, isClubHost } from '@/lib/access'
import type { SessionUser } from '@/lib/session'

type MemberLike = { id: string; profileVisibility: string | null }

/**
 * Given the viewing session and a set of members, returns the IDs of the
 * members whose profile is RESTRICTED to this viewer — i.e. a
 * 'connections only' member the viewer isn't allowed to see in full.
 *
 * A member is restricted unless the viewer is: the member themselves, an
 * accepted connection, or a privileged role (admin / moderator / club
 * host). Mirrors the gating in /api/members and /api/members/[id] so the
 * directory, search, and profile views stay consistent.
 *
 * Cheap by design: returns early (no extra queries) when none of the
 * given members are 'connections only'.
 */
export async function restrictedSetFor(
  session: SessionUser,
  members: MemberLike[],
): Promise<Set<string>> {
  const privateOnes = members.filter(
    m => m.profileVisibility === 'connections' && m.id !== session.id,
  )
  if (privateOnes.length === 0) return new Set()

  // Privileged viewers see everyone in full.
  if (isAdminOrModerator(session) || (await isClubHost(session.id))) return new Set()

  const conns = await prisma.memberConnection.findMany({
    where: {
      status: 'accepted',
      OR: [{ requesterId: session.id }, { receiverId: session.id }],
    },
    select: { requesterId: true, receiverId: true },
  })
  const connectionIds = new Set(
    conns.map(c => (c.requesterId === session.id ? c.receiverId : c.requesterId)),
  )

  return new Set(privateOnes.filter(m => !connectionIds.has(m.id)).map(m => m.id))
}
