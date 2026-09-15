import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { pendingClubRequestsWhere, withStaffReasons } from '@/lib/clubRequests'

// GET /api/admin/clubs/requests — the staff queue for club join requests.
//
// Default: only requests nobody but staff can answer — the club has no approved
// host, or it is inactive (a host can't act on an inactive club), flagged by
// staffReason; the club-side pending list is host-only. ?scope=all adds the
// active hosted clubs' requests for stale ones a host is sitting on.
// hostlessCount applies the same rule as Mod Home's count.
// Acting goes through the existing PATCH /api/clubs/[slug]/members, which
// already admits city staff via canActInCity. Nothing here approves or
// rejects on its own.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const all = req.nextUrl.searchParams.get('scope') === 'all'

    const rows = await prisma.clubMembership.findMany({
      where:   pendingClubRequestsWhere(session),
      orderBy: { joinedAt: 'asc' },
      select: {
        joinedAt: true,
        user: { select: { id: true, name: true, color: true } },
        club: { select: { id: true, slug: true, name: true, emoji: true, cityId: true, isActive: true, isPrivate: true, city: { select: { name: true } } } },
      },
    })
    const tagged = await withStaffReasons(rows)
    const now = Date.now()

    const requests = tagged
      .map(r => ({
        userId:      r.user.id,
        name:        r.user.name,
        color:       r.user.color,
        requestedAt: r.joinedAt,
        ageDays:     Math.floor((now - new Date(r.joinedAt).getTime()) / 86_400_000),
        hasHost:     r.hasHost,
        staffReason: r.staffReason,
        club: {
          id: r.club.id, slug: r.club.slug, name: r.club.name, emoji: r.club.emoji,
          cityName: r.club.city?.name ?? null, isActive: r.club.isActive, isPrivate: r.club.isPrivate,
        },
      }))
      .filter(r => all || r.staffReason !== null)

    return NextResponse.json({
      requests,
      hostlessCount: tagged.filter(r => r.staffReason !== null).length,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
