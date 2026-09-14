import type { Prisma } from '@prisma/client'

/**
 * The one definition of "a member Club.memberCount counts": an approved
 * membership row whose user is not banned. Every live path moves the counter
 * by exactly this rule — joins and approvals +1 on approved rows, leaves and
 * removals −1, a ban −1 per approved membership and an unban +1 (the rows are
 * kept so an unban restores them) — and account deletion removes the rows.
 *
 * The nightly recount used to count approved rows only, so it counted banned
 * members back in and silently reverted every ban's decrement overnight.
 *
 * Suspension is deliberately NOT excluded: no live path decrements on
 * suspend and nothing increments when a suspension lapses, so excluding it
 * here would make the count flap between the recount and the live paths.
 */
export const COUNTED_CLUB_MEMBERSHIP_WHERE = {
  status: 'approved',
  user:   { status: { not: 'banned' } },
} satisfies Prisma.ClubMembershipWhereInput
