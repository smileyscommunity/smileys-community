import type { Prisma } from '@prisma/client'
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

/** True when either member has blocked the other. */
export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const block = await prisma.memberBlock.findFirst({
    where:  { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { id: true },
  })
  return !!block
}

/**
 * The Prisma filter for "members whose name matches `q`", as this viewer may
 * search it. A connections-only member the viewer isn't connected to shows
 * as a first name, so they match only on the start of it — searching a
 * surname (or "first last") used to confirm a surname their card hides.
 * Everyone else matches the way `mode` says. Privileged viewers match all.
 */
export async function nameSearchWhere(
  session: SessionUser,
  q: string,
  mode: 'contains' | 'startsWith',
): Promise<Prisma.UserWhereInput> {
  const match = { [mode]: q, mode: 'insensitive' as const }
  if (isAdminOrModerator(session) || (await isClubHost(session.id))) return { name: match }
  const conns = await prisma.memberConnection.findMany({
    where:  { status: 'accepted', OR: [{ requesterId: session.id }, { receiverId: session.id }] },
    select: { requesterId: true, receiverId: true },
  })
  const connected = conns.map(c => (c.requesterId === session.id ? c.receiverId : c.requesterId))
  return {
    OR: [
      { profileVisibility: { not: 'connections' }, name: match },
      { id: { in: [session.id, ...connected] }, name: match },
      ...(/\s/.test(q) ? [] : [{ profileVisibility: 'connections', name: { startsWith: q, mode: 'insensitive' as const } }]),
    ],
  }
}
