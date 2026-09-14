import { prisma } from '@/lib/prisma'
import { firstNameOf } from '@/lib/data'
import { COMMUNITY_MEMBER_WHERE } from '@/lib/memberCount'

/**
 * A founding member's position in their city: activated community members
 * who joined no later than they did. One definition for the activation email
 * and the dashboard panel — the email used to count approvals (including
 * people who never activated) and so promised "#31" to someone the dashboard
 * later called "#13".
 *
 * `activated: false` is the approval moment: the new account has no password
 * yet, so it isn't in the count and is the next one after it.
 */
export async function foundingRankFor(
  cityId: string,
  member: { joinedAt: Date; activated: boolean },
): Promise<number> {
  const ahead = await prisma.user.count({
    where: { ...COMMUNITY_MEMBER_WHERE, cityId, joinedAt: { lte: member.joinedAt } },
  })
  return member.activated ? Math.max(1, ahead) : ahead + 1
}

/**
 * First names of up to `take` earlier founding members to name in the
 * welcome — activated only, or the email introduces someone who never came.
 */
export async function foundingFellowNames(cityId: string, excludeUserId: string, take = 3): Promise<string[]> {
  const fellows = await prisma.user.findMany({
    where: {
      ...COMMUNITY_MEMBER_WHERE, cityId,
      foundingMember: true, id: { not: excludeUserId }, hiddenFromMembers: false,
    },
    orderBy: { joinedAt: 'asc' },
    take,
    select: { name: true },
  })
  return fellows.map(f => firstNameOf(f.name))
}
