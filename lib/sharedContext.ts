// Shared context between the viewer and other members (Members brief
// §28) — the machinery behind "You and Maria: both in Hiking Club, both
// going Wednesday". Batched: one set of queries answers context for a
// whole page of members, never N+1.
//
// Deliberately NOT a compatibility score (§5/§58): we surface the actual
// overlapping facts and let the reader judge. Ordering uses a weight so
// discovery can rank, but the weight is never displayed.
import { prisma } from './prisma'

export interface SharedContext {
  clubs:        { id: string; name: string; emoji: string; slug: string }[]
  neighborhood: string | null   // set only when both share it
  events:       { id: string; title: string; date: string; emoji: string }[]
  hangouts:     { id: string; title: string }[]
  interests:    string[]
  // Sort weight only — never rendered. Clubs and shared plans are the
  // strongest "you might actually meet" signals; interests the weakest.
  weight: number
}

export const EMPTY_CONTEXT: SharedContext = {
  clubs: [], neighborhood: null, events: [], hangouts: [], interests: [], weight: 0,
}

interface ViewerFacts {
  id: string
  neighborhood: string | null
  interests: string[]
  clubIds: Set<string>
  eventIds: Set<string>
  hangoutIds: Set<string>
}

// The viewer's own memberships/plans — fetched once per request.
export async function loadViewerFacts(userId: string): Promise<ViewerFacts> {
  const today = new Date().toISOString().split('T')[0]
  const [me, clubs, events, hangouts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { neighborhood: true, interests: true } }),
    prisma.clubMembership.findMany({ where: { userId, status: 'approved' }, select: { clubId: true } }),
    prisma.eventAttendee.findMany({
      where:  { userId, status: 'approved', event: { date: { gte: today }, status: 'published' } },
      select: { eventId: true },
    }),
    prisma.hangoutJoin.findMany({
      where:  { userId, hangout: { status: 'active', endsAt: { gte: new Date() } } },
      select: { hangoutId: true },
    }),
  ])
  return {
    id: userId,
    neighborhood: me?.neighborhood ?? null,
    interests: me?.interests ?? [],
    clubIds:    new Set(clubs.map(c => c.clubId)),
    eventIds:   new Set(events.map(e => e.eventId)),
    hangoutIds: new Set(hangouts.map(h => h.hangoutId)),
  }
}

// Shared context for many members at once. `memberIds` should already be
// filtered to approved, non-blocked members by the caller.
export async function sharedContextFor(
  viewer: ViewerFacts,
  memberIds: string[],
): Promise<Map<string, SharedContext>> {
  const out = new Map<string, SharedContext>()
  if (memberIds.length === 0) return out
  const today = new Date().toISOString().split('T')[0]

  const [members, clubRows, eventRows, hangoutRows] = await Promise.all([
    prisma.user.findMany({
      where:  { id: { in: memberIds } },
      select: { id: true, neighborhood: true, interests: true },
    }),
    viewer.clubIds.size > 0
      ? prisma.clubMembership.findMany({
          where:  { userId: { in: memberIds }, status: 'approved', clubId: { in: [...viewer.clubIds] } },
          select: { userId: true, club: { select: { id: true, name: true, emoji: true, slug: true } } },
        })
      : Promise.resolve([]),
    viewer.eventIds.size > 0
      ? prisma.eventAttendee.findMany({
          where:  {
            userId: { in: memberIds }, status: 'approved',
            eventId: { in: [...viewer.eventIds] },
            event: { date: { gte: today } },
          },
          select: { userId: true, event: { select: { id: true, title: true, date: true, emoji: true } } },
        })
      : Promise.resolve([]),
    viewer.hangoutIds.size > 0
      ? prisma.hangoutJoin.findMany({
          where:  { userId: { in: memberIds }, hangoutId: { in: [...viewer.hangoutIds] } },
          select: { userId: true, hangout: { select: { id: true, title: true } } },
        })
      : Promise.resolve([]),
  ])

  for (const id of memberIds) out.set(id, { ...EMPTY_CONTEXT, clubs: [], events: [], hangouts: [], interests: [] })

  for (const r of clubRows) out.get(r.userId)?.clubs.push(r.club)
  for (const r of eventRows) out.get(r.userId)?.events.push(r.event)
  for (const r of hangoutRows) out.get(r.userId)?.hangouts.push(r.hangout)

  const viewerInterests = new Set(viewer.interests)
  for (const m of members) {
    const ctx = out.get(m.id)
    if (!ctx) continue
    if (viewer.neighborhood && m.neighborhood === viewer.neighborhood) ctx.neighborhood = m.neighborhood
    ctx.interests = m.interests.filter(i => viewerInterests.has(i)).slice(0, 3)
    ctx.weight =
      ctx.clubs.length * 5 +
      ctx.events.length * 4 +
      ctx.hangouts.length * 4 +
      (ctx.neighborhood ? 3 : 0) +
      ctx.interests.length
  }
  return out
}

// One-line summary for cards (§8) — the single strongest fact, phrased
// as a reason to talk rather than a statistic.
export function contextLabel(ctx: SharedContext): string | null {
  if (ctx.clubs.length === 1) return `Also in ${ctx.clubs[0].name}`
  if (ctx.clubs.length > 1)   return `${ctx.clubs.length} clubs in common`
  if (ctx.events.length > 0)  return `Also going to ${ctx.events[0].title}`
  if (ctx.hangouts.length > 0) return `Joining ${ctx.hangouts[0].title}`
  if (ctx.neighborhood)       return `Lives around ${ctx.neighborhood}`
  if (ctx.interests.length > 0) return `Both into ${ctx.interests[0]}`
  return null
}
