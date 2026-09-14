import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, hostCityIds } from '@/lib/access'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admins see all clubs
  if (isAdmin(session)) {
    const clubs = await prisma.club.findMany({
      select: { id: true, name: true, emoji: true, slug: true, memberCount: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(clubs.map(c => ({ ...c, canManage: true })))
  }

  // Everyone else (hosts, moderators) sees only clubs they are assigned to
  const memberships = await prisma.clubMembership.findMany({
    // canManage links to /host/clubs/[slug], which refuses an inactive club's hosts.
    where: { userId: session.id, role: 'host', status: 'approved', club: { isActive: true } },
    select: { club: { select: { id: true, name: true, emoji: true, slug: true, memberCount: true } } },
    orderBy: { club: { name: 'asc' } },
  })
  // `canManage` says whether /host/clubs/[slug] will open for this viewer —
  // it requires an approved host membership (or admin). The My Clubs list
  // linked every row there, so a city host's city clubs all 404'd.
  const clubs: { id: string; name: string; emoji: string; slug: string; memberCount: number; canManage: boolean }[] =
    memberships.map(m => ({ ...m.club, canManage: true }))

  // A city host (consul) runs events across their city without per-club host
  // grants — the create form was unusable for them (empty club list, then a
  // 403 at submit). They may file events under any active club in a city
  // they host; the admin events POST enforces the same boundary server-side.
  const cities = await hostCityIds(session.id)
  if (cities.length > 0) {
    const cityClubs = await prisma.club.findMany({
      where:  { cityId: { in: cities }, isActive: true, id: { notIn: clubs.map(c => c.id) } },
      select: { id: true, name: true, emoji: true, slug: true, memberCount: true },
      orderBy: { name: 'asc' },
    })
    clubs.push(...cityClubs.map(c => ({ ...c, canManage: false })))
  }
  return NextResponse.json(clubs)
}
