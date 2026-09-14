import type { Prisma } from '@prisma/client'

/**
 * A referral is real when the application that carried the referrer's code
 * (MemberApplication.referredBy = User.referralCode) is APPROVED — that is the
 * moment the UI copy describes ("Brought in N members", the invite page's
 * "approved" tally), and it is the source of truth every display reads.
 *
 * User.referralCount is not read anywhere any more: nothing ever incremented
 * it, so it drifted from real activity (20 users in the 2026-09 audit).
 * scripts/repair-referral-counts.ts keeps the stored column consistent with
 * this rule until it is dropped.
 */
export const REFERRAL_COUNTED_STATUSES = ['approved', 'active'] as const

export function countedReferralsWhere(referralCode: string) {
  return {
    referredBy: referralCode,
    status:     { in: [...REFERRAL_COUNTED_STATUSES] },
  } satisfies Prisma.MemberApplicationWhereInput
}
