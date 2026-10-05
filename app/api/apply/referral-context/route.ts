import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { firstNameOf } from '@/lib/data'
import { REFERRAL_COUNTED_STATUSES } from '@/lib/referrals'

// GET /api/apply/referral-context?ref=XYZ
//
// Powers the apply-form social proof. Two payloads in one:
//
//   1. `inviter` — when `?ref=XYZ` matches a real member's referralCode,
//      we return their first name + avatar so the form can say "Sarah
//      invited you to apply" with a face next to it. Personalized +
//      from a known member is much stronger conversion than aggregate
//      stats.
//
//   2. `totalActiveInviters` — count of distinct members who've
//      successfully brought in at least one approved member. Backs the
//      always-on "N members have brought friends in" line so applicants
//      without a ref code still see the loop is real.
//
// Public endpoint (no auth) because the apply form is pre-account.
// Rate-limited per IP so a scraper can't probe ref codes en masse.
export async function GET(req: NextRequest) {
  if (!await rateLimit(`apply-ref:${getIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const ref = new URL(req.url).searchParams.get('ref')?.trim() || null

  const [inviter, totalActiveInviters] = await Promise.all([
    ref
      ? prisma.user.findUnique({
          where:  { referralCode: ref },
          select: { name: true, color: true, profilePhoto: true, status: true, profileVisibility: true, hiddenFromMembers: true, suspendedUntil: true },
        })
      : Promise.resolve(null),
    // Distinct members who've brought in ≥1 approved/active applicant.
    // groupBy on referredBy + filter ensures we count each inviter once
    // regardless of how many friends they brought in.
    prisma.memberApplication.groupBy({
      by:     ['referredBy'],
      where:  { referredBy: { not: null }, status: { in: [...REFERRAL_COUNTED_STATUSES] } },
      _count: { _all: true },
    }).then(rows => rows.length),
  ])

  // Mask anything off about the inviter (banned / not yet approved) so
  // the form doesn't accidentally welcome someone with a stale code.
  // Suspended or admin-hidden members don't recruit (their referral isn't
  // credited either — app/api/apply). A connections-only member's face is not
  // public: a guest gets the first name and the color, no photo — the rule
  // the members-only invite route already applies.
  const listable = inviter && inviter.status === 'approved' && !inviter.hiddenFromMembers
    && !(inviter.suspendedUntil && inviter.suspendedUntil > new Date())
  const inviterPayload = inviter && listable
    ? {
        firstName:    firstNameOf(inviter.name),
        color:        inviter.color,
        profilePhoto: inviter.profileVisibility === 'connections' ? null : inviter.profilePhoto,
      }
    : null

  return NextResponse.json({
    inviter:             inviterPayload,
    totalActiveInviters,
  })
}
