import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, hostCityIds } from '@/lib/access'

// Each club's city rides along (a relation select, one batched query — not a
// lookup per club). The new-event form geocodes, lists neighborhoods and
// labels prices in the SELECTED club's city: the event is filed there, and
// the browsed city sent a Tbilisi club's address to a Türkiye-only search.
// null = a global club, which the server files into the browsed city.
const CLUB_SELECT = {
  id: true, name: true, emoji: true, slug: true, memberCount: true,
  city: { select: { id: true, slug: true, name: true, country: true, timezone: true, currency: true } },
} as const
type ClubCity = { id: string; slug: string; name: string; country: string; timezone: string; currency: string }

// Every row says three things about the caller and that club:
//   canManage        /host/clubs/[slug] opens for them. That page admits an
//                    admin, or an approved host of an ACTIVE club — nobody
//                    else, city hosts included — so link anything else to the
//                    public /clubs/[slug] instead of a 404.
//   canCreateEvents  the event-create route will accept this club. Every row
//                    here is one: clubs the caller hosts, and for a city host
//                    every active club in their cities. (Admins: any club.)
//   hosted           the caller holds an approved host membership. For an
//                    admin, whose list is every club in every city, this is
//                    what "my clubs" means (HostProfileCard shows only these).
type HostClubRow = {
  id: string; name: string; emoji: string; slug: string; memberCount: number; city: ClubCity | null
  canManage: boolean; canCreateEvents: boolean; hosted: boolean
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admins see all clubs — the create and edit forms file events under any of them.
  if (isAdmin(session)) {
    const clubs = await prisma.club.findMany({
      select: {
        ...CLUB_SELECT,
        memberships: { where: { userId: session.id, role: 'host', status: 'approved' }, select: { id: true }, take: 1 },
      },
      orderBy: { name: 'asc' },
    })
    const rows: HostClubRow[] = clubs.map(({ memberships, ...c }) => ({
      ...c, canManage: true, canCreateEvents: true, hosted: (memberships?.length ?? 0) > 0,
    }))
    return NextResponse.json(rows)
  }

  // Everyone else (hosts, moderators) sees only clubs they are assigned to
  const memberships = await prisma.clubMembership.findMany({
    // canManage links to /host/clubs/[slug], which refuses an inactive club's hosts.
    where: { userId: session.id, role: 'host', status: 'approved', club: { isActive: true } },
    select: { club: { select: CLUB_SELECT } },
    orderBy: { club: { name: 'asc' } },
  })
  // `canManage` says whether /host/clubs/[slug] will open for this viewer —
  // it requires an approved host membership (or admin). The My Clubs list
  // linked every row there, so a city host's city clubs all 404'd.
  const clubs: HostClubRow[] =
    memberships.map(m => ({ ...m.club, canManage: true, canCreateEvents: true, hosted: true }))

  // A city host (consul) runs events across their city without per-club host
  // grants — the create form was unusable for them (empty club list, then a
  // 403 at submit). They may file events under any active club in a city
  // they host; the admin events POST enforces the same boundary server-side.
  const cities = await hostCityIds(session.id)
  if (cities.length > 0) {
    const cityClubs = await prisma.club.findMany({
      where:  { cityId: { in: cities }, isActive: true, id: { notIn: clubs.map(c => c.id) } },
      select: CLUB_SELECT,
      orderBy: { name: 'asc' },
    })
    clubs.push(...cityClubs.map(c => ({ ...c, canManage: false, canCreateEvents: true, hosted: false })))
  }
  return NextResponse.json(clubs)
}
