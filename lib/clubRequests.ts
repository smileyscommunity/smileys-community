import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isAdmin, failClosedCityId } from '@/lib/access'
import type { SessionUser } from '@/lib/session'
import { COUNTED_CLUB_MEMBERSHIP_WHERE } from '@/lib/clubMemberCount'
import { clubRequestStaffReason, type ClubStaffReason } from '@/lib/clubRequestRouting'

// Pending club join requests only a club host can see from the club side, so a
// club with no approved host left its requests stranded (42 stale at the
// 2026-09 audit, 99 active clubs hostless). These helpers feed the staff queue
// at /admin/club-requests and its Mod Home count. Requests to an inactive club
// are staff-only too, host or not — lib/clubRequestRouting holds the rule.

// Which pending requests a staff member may see. Admin: all. Moderator: their
// city's clubs, plus global clubs only for requesters from their city — the
// request carries the member's identity, and a global club is not "theirs".
export function pendingClubRequestsWhere(session: SessionUser): Prisma.ClubMembershipWhereInput {
  if (isAdmin(session)) return { status: 'pending' }
  const cityId = failClosedCityId(session)
  return {
    status: 'pending',
    OR: [
      { club: { cityId } },
      { club: { cityId: null }, user: { cityId } },
    ],
  }
}

// Clubs (of those given) with at least one approved, non-banned host — the
// same counted-membership rule the member counter uses.
export async function hostedClubIds(clubIds: string[]): Promise<Set<string>> {
  if (clubIds.length === 0) return new Set()
  const rows = await prisma.clubMembership.findMany({
    where:    { ...COUNTED_CLUB_MEMBERSHIP_WHERE, role: 'host', clubId: { in: clubIds } },
    select:   { clubId: true },
    distinct: ['clubId'],
  })
  return new Set(rows.map(r => r.clubId))
}

// Tags each pending request with whether only staff can answer it, and why.
// The queue list and its count both go through here so they can't drift.
export async function withStaffReasons<T extends { club: { id: string; isActive: boolean } }>(
  rows: T[],
): Promise<Array<T & { hasHost: boolean; staffReason: ClubStaffReason | null }>> {
  const hosted = await hostedClubIds([...new Set(rows.map(r => r.club.id))])
  return rows.map(r => {
    const hasHost = hosted.has(r.club.id)
    return { ...r, hasHost, staffReason: clubRequestStaffReason({ isActive: r.club.isActive, hasHost }) }
  })
}

// Name kept for its callers; it also counts requests to inactive clubs, whose
// hosts can no longer answer them.
export async function countHostlessClubRequests(session: SessionUser): Promise<number> {
  const rows = await prisma.clubMembership.findMany({
    where:  pendingClubRequestsWhere(session),
    select: { club: { select: { id: true, isActive: true } } },
  })
  return (await withStaffReasons(rows)).filter(r => r.staffReason !== null).length
}
