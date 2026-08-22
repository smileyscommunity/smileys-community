import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { loadViewerFacts, sharedContextFor, contextLabel } from '@/lib/sharedContext'
import { rotationSeed, seededShuffle } from '@/lib/rotation'

// Contextual member discovery (Members brief §5–6): the sections that
// replace "all 2,000 members" as the top of the page. One request serves
// every section so the homepage doesn't fan out into six fetches.
//
// Privacy: only approved members, never the viewer, never blocked pairs
// in either direction, and members with profileVisibility='connections'
// appear only to their accepted connections.
//
// Rotation: each section draws from a WIDE candidate pool (ids only) that
// is shuffled per viewer per 30-minute window. Slicing a narrow, joinedAt-
// ordered query — what this route used to do — showed every member the
// same handful of faces on every visit. See lib/rotation.ts for why the
// window is a window and not per-request.

const CARD_SELECT = {
  id: true, name: true, color: true, profilePhoto: true,
  neighborhood: true, interests: true, joinedAt: true, role: true,
} as const

// How many candidates each section pulls (ids only) before rotation, and
// how many survive rotation into the scoring/display set.
//
// POOL is a runaway guard, NOT a display limit: it has to clear the whole
// eligible set or the members past the cut are invisible forever, which is
// the bug this route is fixing (the median member shares a club with ~1370
// others). 1374 approved members today; one id column at this size is a
// few tens of KB. Past a few thousand this needs a DB-side sampled window
// instead of a full id fetch.
const POOL = 5000
const SAMPLE = 24
const SHOW = 8

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const viewer = await loadViewerFacts(session.id)
  const seed = rotationSeed(session.id)

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
    // Discovery is "people near you" — without the city scope every one of
    // its sections mixed all cities' members (the last unscoped member
    // surface after the multi-city pass).
    cityId: await resolveCityId(session),
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

  const ids = (rows: { id: string }[]) => rows.map(r => r.id)

  // Pass 1 — candidate ids per section. Cheap (one indexed column), so
  // each pool can be the whole eligible set rather than the 8 the section
  // happens to render.
  // The viewer's "looking for" answers — the registration question that was
  // write-only until phase B. Feeds the shared-goals section below.
  const viewerLookingFor =
    (await prisma.user.findUnique({ where: { id: session.id }, select: { lookingFor: true } }))?.lookingFor ?? []

  const [clubPool, hoodPool, eventPool, newPool, hostPool, goalsPool] = await Promise.all([
    // §12 — people in your clubs
    clubIds.length > 0
      ? prisma.user.findMany({
          where:  { ...visibleWhere, clubMemberships: { some: { clubId: { in: clubIds }, status: 'approved' } } },
          select: { id: true },
          take:   POOL,
        })
      : Promise.resolve([]),
    // §13 — around your neighborhood
    viewer.neighborhood
      ? prisma.user.findMany({
          where:  { ...visibleWhere, neighborhood: viewer.neighborhood },
          select: { id: true },
          take:   POOL,
        })
      : Promise.resolve([]),
    // §14 — going where you're going
    viewer.eventIds.size > 0
      ? prisma.user.findMany({
          where: {
            ...visibleWhere,
            joinedEvents: { some: { eventId: { in: [...viewer.eventIds] }, status: 'approved' } },
          },
          select: { id: true },
          take:   POOL,
        })
      : Promise.resolve([]),
    // §15 — new to Smileys. Still genuinely recent (30-day window, newest
    // first into the pool); rotation then varies WHICH newcomers you greet.
    prisma.user.findMany({
      where:   { ...visibleWhere, joinedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      select:  { id: true },
      take:    60,
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
      select: { id: true },
      take:   POOL,
    }),
    // Looking for the same things — lookingFor overlap with the viewer
    // (the same matching idea the visitors feature already uses).
    viewerLookingFor.length > 0
      ? prisma.user.findMany({
          where:  { ...visibleWhere, lookingFor: { hasSome: viewerLookingFor } },
          select: { id: true },
          take:   POOL,
        })
      : Promise.resolve([]),
  ])

  // Rotate each pool, then keep a sample big enough to both fill the
  // section and feed "people you might meet" a varied candidate set.
  const rotate = (pool: { id: string }[], salt: string) =>
    seededShuffle(ids(pool), `${seed}:${salt}`).slice(0, SAMPLE)

  const clubSample  = rotate(clubPool,  'clubs')
  const hoodSample  = rotate(hoodPool,  'hood')
  const eventSample = rotate(eventPool, 'events')
  const newSample   = rotate(newPool,   'new')
  const hostSample  = rotate(hostPool,  'hosts')
  const goalsSample = rotate(goalsPool, 'goals')

  // Pass 2 — one card fetch + one context pass over everyone who can
  // appear anywhere on the page.
  const unionIds = [...new Set([...clubSample, ...hoodSample, ...eventSample, ...newSample, ...hostSample, ...goalsSample])]
  const [cardRows, ctx] = await Promise.all([
    unionIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: unionIds } }, select: CARD_SELECT })
      : Promise.resolve([]),
    sharedContextFor(viewer, unionIds),
  ])
  const cards = new Map(cardRows.map(m => [m.id, m]))

  const shape = (m: NonNullable<ReturnType<typeof cards.get>>) => {
    const c = ctx.get(m.id)
    return {
      id: m.id, name: m.name, color: m.color, profilePhoto: m.profilePhoto,
      neighborhood: m.neighborhood,
      interests: m.interests.slice(0, 3),
      isHost: m.role === 'host',
      context: c ? { label: contextLabel(c), clubs: c.clubs.slice(0, 2) } : null,
    }
  }

  const section = (sample: string[]) =>
    sample.map(id => cards.get(id)).filter(Boolean).slice(0, SHOW).map(m => shape(m!))

  // §7 — "People you might meet": everyone with real shared context,
  // strongest first. Never a score, just an ordering. Ties — and one
  // shared club is by far the most common case — are broken by the current
  // rotation instead of by row order, so the top of the page turns over.
  const mightMeet = seededShuffle(unionIds, `${seed}:meet`)
    .map(id => ({ id, weight: ctx.get(id)?.weight ?? 0 }))
    .filter(x => x.weight > 0 && cards.has(x.id))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, SHOW)
    .map(x => shape(cards.get(x.id)!))

  return NextResponse.json({
    mightMeet,
    clubMates:  section(clubSample),
    neighbours: section(hoodSample),
    eventMates: section(eventSample),
    newcomers:  section(newSample),
    hosts:      section(hostSample),
    sharedGoals: section(goalsSample),
    viewer: { neighborhood: viewer.neighborhood, hasClubs: clubIds.length > 0 },
  })
}
