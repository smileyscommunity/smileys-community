import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isAdmin, failClosedCityId } from '@/lib/access'
import type { SessionUser } from '@/lib/session'

/**
 * Which reports belong to a city.
 *
 * A report about a piece of content — a board post (or a reply on one), a
 * marketplace listing, a neighbourhood-wall post — belongs to the city the
 * content was posted in, because that is where a moderator can act on it: the
 * delete routes check the content's city, not the author's. A member from one
 * city posting in another's board put the report in the queue of the
 * moderator who couldn't remove it, and out of the one who could. Every other
 * report belongs to the reported member's city.
 *
 * Content that no longer exists has no city to file under, so its report falls
 * back to the reported member's city rather than dropping out of every
 * moderator's queue.
 *
 * Report carries only the content ids (no relations), so the content's city is
 * looked up here and turned back into id lists.
 */
export async function reportCityWhere(cityId: string): Promise<Prisma.ReportWhereInput> {
  const withContent = await prisma.report.findMany({
    where:  { OR: [{ boardPostId: { not: null } }, { listingId: { not: null } }, { neighborhoodPostId: { not: null } }] },
    select: { boardPostId: true, listingId: true, neighborhoodPostId: true },
  })
  const idsOf = (k: 'boardPostId' | 'listingId' | 'neighborhoodPostId') =>
    [...new Set(withContent.flatMap(r => r[k] ? [r[k] as string] : []))]
  const postIds = idsOf('boardPostId'), listingIds = idsOf('listingId'), wallIds = idsOf('neighborhoodPostId')

  const [posts, listings, wallPosts] = await Promise.all([
    postIds.length    ? prisma.boardPost.findMany(       { where: { id: { in: postIds } },    select: { id: true, cityId: true } }) : [],
    listingIds.length ? prisma.listing.findMany(         { where: { id: { in: listingIds } }, select: { id: true, cityId: true } }) : [],
    wallIds.length    ? prisma.neighborhoodPost.findMany({ where: { id: { in: wallIds } },    select: { id: true, cityId: true } }) : [],
  ])
  const split = (ids: string[], rows: { id: string; cityId: string }[]) => {
    const found = new Set(rows.map(r => r.id))
    return {
      here:    rows.filter(r => r.cityId === cityId).map(r => r.id),
      missing: ids.filter(id => !found.has(id)),
    }
  }
  const p = split(postIds, posts), l = split(listingIds, listings), w = split(wallIds, wallPosts)

  return {
    OR: [
      // About a member (or about content that's gone): the member's city.
      {
        AND: [
          { OR: [{ boardPostId: null },        { boardPostId:        { in: p.missing } }] },
          { OR: [{ listingId: null },          { listingId:          { in: l.missing } }] },
          { OR: [{ neighborhoodPostId: null }, { neighborhoodPostId: { in: w.missing } }] },
        ],
        reported: { is: { cityId } },
      },
      { boardPostId:        { in: p.here } },
      { listingId:          { in: l.here } },
      { neighborhoodPostId: { in: w.here } },
    ],
  }
}

/**
 * The reports a staff member may triage: the moderation queue's filter, and so
 * every badge that counts it. Admins see every city (or `cityId` when they ask
 * for one); a moderator sees only their own city, and a moderator without a
 * city fails closed to nothing. Nobody sees reports about themselves — for
 * survey-sourced reports the responder was promised anonymity from the host,
 * who may well hold the moderator role.
 *
 * Badges used to count by the reported member's city and include reports about
 * the viewer, so the number beside "Reports" and the list it opened disagreed.
 */
export async function reportQueueWhere(
  session: SessionUser,
  opts: { cityId?: string | null } = {},
): Promise<Prisma.ReportWhereInput> {
  const cityId = isAdmin(session) ? (opts.cityId ?? null) : failClosedCityId(session)
  const scope  = cityId ? await reportCityWhere(cityId) : {}
  return { ...scope, reportedId: { not: session.id } }
}
