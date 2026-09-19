import { NextResponse } from 'next/server'
import { restrictedSetFor } from '@/lib/memberPrivacy'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { firstNameOf } from '@/lib/data'

// GET — return list of people who viewed my profile (last 30 days)
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Exclude viewers the current user has blocked (or who blocked them)
  const blocks = await prisma.memberBlock.findMany({
    where: { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
    select: { blockerId: true, blockedId: true },
  })
  const blockedIds = new Set(blocks.map(b => b.blockerId === session.id ? b.blockedId : b.blockerId))

  const views = await prisma.profileView.findMany({
    where: {
      viewedId:  session.id,
      createdAt: { gte: since },
      viewerId:  { not: session.id, notIn: [...blockedIds] },
      // Live members only, and not staff or club hosts: views are no longer
      // recorded for those (they open profiles to do their jobs), and rows
      // from before that change shouldn't list them either. A banned,
      // hidden or suspended viewer isn't on any member surface.
      viewer: {
        status: 'approved', hiddenFromMembers: false, role: 'member',
        OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
        clubMemberships: { none: { role: 'host', status: 'approved', club: { isActive: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      viewer: { select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true, neighborhoodVisible: true, profileVisibility: true } },
    },
  })

  // A connections-only viewer the profile owner isn't connected to shows as
  // on their profile: first name, no photo, no neighbourhood.
  const restricted = await restrictedSetFor(session, views.map(v => v.viewer))
  return NextResponse.json(views.map(v => ({
    id: v.id,
    viewedAt: v.createdAt,
    viewer: {
      id:           v.viewer.id,
      name:         restricted.has(v.viewer.id) ? firstNameOf(v.viewer.name) : v.viewer.name,
      color:        v.viewer.color,
      photo:        restricted.has(v.viewer.id) ? null : v.viewer.profilePhoto,
      neighborhood: restricted.has(v.viewer.id) || !v.viewer.neighborhoodVisible ? null : v.viewer.neighborhood,
      restricted:   restricted.has(v.viewer.id),
    },
  })))
}
