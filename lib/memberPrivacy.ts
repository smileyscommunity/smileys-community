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
 *
 * `knownConnectionIds` lets a caller that ALREADY holds the viewer's accepted
 * connections skip the lookup below. The dashboard is the case that motivated
 * it: it fetches exactly this set for its own LISTABLE filter, then called
 * here and the same query ran a second time on the same request — and since
 * the widget rework it fires on most non-empty dashboards rather than rarely.
 * Optional, not required: most of the ~25 callers have no connections in
 * scope, and making them fetch some to satisfy a signature would be worse
 * than the duplicate. Same shape as standingLevelsFor's optional enforcement.
 *
 * CONTRACT: it must be the ids of THIS session's accepted connections — the
 * other party of every `memberConnection` row with status 'accepted' where the
 * session is requester or receiver, which is what connectionIdsFor returns. A
 * wrong or partial set silently exposes a connections-only member or hides one
 * who consented, so pass it only when it came from that query. When in doubt,
 * omit it and take the extra read.
 */
export async function restrictedSetFor(
  session: SessionUser,
  members: MemberLike[],
  knownConnectionIds?: Iterable<string>,
): Promise<Set<string>> {
  const privateOnes = members.filter(
    m => m.profileVisibility === 'connections' && m.id !== session.id,
  )
  if (privateOnes.length === 0) return new Set()

  // Privileged viewers see everyone in full.
  if (isAdminOrModerator(session) || (await isClubHost(session.id))) return new Set()

  const connectionIds = knownConnectionIds
    ? new Set(knownConnectionIds)
    : await connectionIdsFor(session.id)

  return new Set(privateOnes.filter(m => !connectionIds.has(m.id)).map(m => m.id))
}

/**
 * The other party of every accepted connection this member holds. Extracted so
 * the query behind `knownConnectionIds` has one definition rather than being
 * re-typed at each caller — two copies of this `where` is how a caller ends up
 * passing a set that means something subtly different.
 */
export async function connectionIdsFor(userId: string): Promise<Set<string>> {
  const conns = await prisma.memberConnection.findMany({
    where: {
      status: 'accepted',
      OR: [{ requesterId: userId }, { receiverId: userId }],
    },
    select: { requesterId: true, receiverId: true },
  })
  return new Set(conns.map(c => (c.requesterId === userId ? c.receiverId : c.requesterId)))
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

/**
 * Everyone this member has a block with, either direction — for a fan-out
 * that would otherwise notify them. A block severs the connection and unseats
 * the pair from each other's hangouts, but a third party's hangout or a
 * shared event still put them in the same room: the chat there kept pushing
 * one member's name and words to the other, every few minutes.
 */
export async function blockedIdsFor(userId: string): Promise<Set<string>> {
  const rows = await prisma.memberBlock.findMany({
    where:  { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  })
  return new Set(rows.map(b => (b.blockerId === userId ? b.blockedId : b.blockerId)))
}
