import type { Prisma } from '@prisma/client'

/**
 * The one definition of "a member" wherever a number of members is shown to
 * the public or to members: approved (which also excludes banned — a ban
 * writes status 'banned') AND activated, i.e. they set a password through
 * their activation link. Activation is represented by `password` being set;
 * the activate route refuses a second activation on exactly that check.
 *
 * Approval alone used to count, and the 2026-09 production audit found 268
 * approved members who had never activated — people who never saw the site
 * inflating every "N members" figure and the city maturity thresholds.
 *
 * Club.memberCount is enrolment and deliberately NOT this rule
 * (lib/clubMemberCount). Admin surfaces show both halves of the funnel via
 * NOT_ACTIVATED_MEMBER_WHERE.
 *
 * Spread it and add filters after, never before — a later `status` key would
 * silently widen the count again.
 */
export const ACTIVATED_MEMBER_WHERE = {
  status:   'approved',
  password: { not: null },
} satisfies Prisma.UserWhereInput

/** Approved but never activated — the admin funnel's other half. */
export const NOT_ACTIVATED_MEMBER_WHERE = {
  status:   'approved',
  password: null,
} satisfies Prisma.UserWhereInput
