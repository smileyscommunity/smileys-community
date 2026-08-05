import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { loadViewerFacts, sharedContextFor, contextLabel } from '@/lib/sharedContext'

// Contextual member discovery (Members brief §5–6): the sections that
// replace "all 2,000 members" as the top of the page. One request serves
// every section so the homepage doesn't fan out into six fetches.
//
// Privacy: only approved members, never the viewer, never blocked pairs
// in either direction, and members with profileVisibility='connections'
// appear only to their accepted connections.

const CARD_SELECT = {
  id: true, name: true, color: true, profilePhoto: true,
  neighborhood: true, interests: true, joinedAt: true, role: true,
} as const

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const viewer = await loadViewerFacts(session.id)

  // Exclusions: blocks (both directions) + self.
  const blocks = await prisma.memberBlock.findMany({
    where:  { OR: [{ blockerId: session.id }, { blockedId: session.id }] },
    select: { blockerId: true, blockedId: true },
  })
  const excluded = new Set<string>([session.id])
  for (const b of blocks) { excluded.add(b.blockerId); excluded.add(b.blockedId) }

  // Restricted members (visibility='connections') are visible only to
  // accepted connections.
  const conns = await prisma.memberConnection.findMany({
    where:  { status: 'accepted', OR: [{ requesterId: session.id }, { receiverId: session.id }] },
    select: { requesterId: true, receiverId: true },
  })
  const connectedIds = new Set(conns.map(c => c.requesterId === session.id ? c.receiverId : c.requesterId))

  const visibleWhere = {
    status: 'approved' as const,
    id: { notIn: [...excluded] },
    OR: [
      { profileVisibility: 'everyone' },
      { id: { in: [...connectedIds] } },
    ],
  }

  const today = new Date().toISOString().split('T')[0]
  const clubIds = [...viewer.clubIds]

  // Event.hostId is a bare column (no User back-relation), so upcoming
  // hosts are resolved by id rather than a nested relation filter.
  const upcomingHosts = await prisma.event.findMany({
    where:  { date: { gte: today }, status: 'published' },
    select: { hostId: true },
    take:   200,
  })
  const hostIds = [...new Set(upcomingHosts.map(e => e.hostId).filter(Boolean))]

  const [clubMates, neighbours, eventMates, newcomers, hosts] = await Promise.all([
    // §12 — people in your clubs
    clubIds.length > 0
      ? prisma.user.findMany({
          where:   { ...visibleWhere, clubMemberships: { some: { clubId: { in: clubIds }, status: 'approved' } } },
          select:  CARD_SELECT,
          take:    12,
          orderBy: { joinedAt: 'desc' },
        })
      : Promise.resolve([]),
    // §13 — around your neighborhood
    viewer.neighborhood
      ? prisma.user.findMany({
          where:   { ...visibleWhere, neighborhood: viewer.neighborhood },
          select:  CARD_SELECT,
          take:    8,
          orderBy: { joinedAt: 'desc' },
        })
      : Promise.resolve([]),
    // §14 — going where you're going
    viewer.eventIds.size > 0
      ? prisma.user.findMany({
          where: {
            ...visibleWhere,
            joinedEvents: { some: { eventId: { in: [...viewer.eventIds] }, status: 'approved' } },
          },
          select: CARD_SELECT,
          take:   8,
        })
      : Promise.resolve([]),
    // §15 — new to Smileys (recent joiners; no exact signup dates exposed)
    prisma.user.findMany({
      where:   { ...visibleWhere, joinedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      select:  CARD_SELECT,
      take:    8,
      orderBy: { joinedAt: 'desc' },
    }),
    // §16 — hosts and community people
    prisma.user.findMany({
      where: {
        ...visibleWhere,
        AND: [{
          OR: [
            { clubMemberships: { some: { role: 'host', status: 'approved' } } },
            { id: { in: hostIds } },
          ],
        }],
      },
      select: CARD_SELECT,
      take:   8,
    }),
  ])

  // One batched context pass over every member that appears anywhere.
  const all = [...clubMates, ...neighbours, ...eventMates, ...newcomers, ...hosts]
  const ctx = await sharedContextFor(viewer, [...new Set(all.map(m => m.id))])

  const shape = (m: typeof all[number]) => {
    const c = ctx.get(m.id)
    return {
      id: m.id, name: m.name, color: m.color, profilePhoto: m.profilePhoto,
      neighborhood: m.neighborhood,
      interests: m.interests.slice(0, 3),
      isHost: m.role === 'host',
      context: c ? { label: contextLabel(c), clubs: c.clubs.slice(0, 2) } : null,
    }
  }

  // §7 — "People you might meet": everyone with real shared context,
  // strongest first. Never a score, just an ordering.
  const mightMeet = [...new Set(all.map(m => m.id))]
    .map(id => ({ id, weight: ctx.get(id)?.weight ?? 0 }))
    .filter(x => x.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .map(x => shape(all.find(m => m.id === x.id)!))

  return NextResponse.json({
    mightMeet,
    clubMates:  clubMates.slice(0, 8).map(shape),
    neighbours: neighbours.map(shape),
    eventMates: eventMates.map(shape),
    newcomers:  newcomers.map(shape),
    hosts:      hosts.map(shape),
    viewer: { neighborhood: viewer.neighborhood, hasClubs: clubIds.length > 0 },
  })
}
