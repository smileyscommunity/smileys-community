import type { Prisma } from '@prisma/client'

/**
 * The one definition of "a member Club.memberCount counts": an approved
 * membership row whose user is not banned AND has activated their account
 * (set a password — lib/memberCount ACTIVATED_MEMBER_WHERE). Never-activated
 * accounts are auto-enrolled at approval but have never seen the site, so
 * counting them put "Social Istanbul" at 1,851 while the whole community had
 * ~1,560 activated members (prod, 2026-10-02: 342 approved, never activated).
 *
 * Live paths still move the counter by enrollment (join/approve +1, leave/
 * remove −1, ban −1, unban +1); activation does not touch it. The nightly
 * recount (api/cron/sweep-event-spots) applies THIS rule and reconciles the
 * difference, so a count can lag an activation by up to a day.
 *
 * The recount used to count approved rows only, so it counted banned
 * members back in and silently reverted every ban's decrement overnight.
 *
 * Suspension is deliberately NOT excluded: no live path decrements on
 * suspend and nothing increments when a suspension lapses, so excluding it
 * here would make the count flap between the recount and the live paths.
 */
export const COUNTED_CLUB_MEMBERSHIP_WHERE = {
  status: 'approved',
  user:   { status: { not: 'banned' }, password: { not: null } },
} satisfies Prisma.ClubMembershipWhereInput

/** Enrollment: approved and not banned, activated or not (admin funnel audits). */
export const ENROLLED_CLUB_MEMBERSHIP_WHERE = {
  status: 'approved',
  user:   { status: { not: 'banned' } },
} satisfies Prisma.ClubMembershipWhereInput
