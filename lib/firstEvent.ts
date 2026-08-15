import { dayInTz, DEFAULT_TZ } from './cityTime'
import { prisma } from '@/lib/prisma'

// "Your First Event" matcher — a deterministic recommender aimed at the
// biggest funnel leak (signed-in → first RSVP, ~45% as of July 2026).
// Intentionally NOT an LLM: the catalog is ~7 events/week, so relevance +
// invitation beats search. See project_smileys_funnel_baseline for the why.

// Weights. interest overlap dominates; first-timer + local proximity are the
// invitation signals; soonness + social proof are tie-breakers.
const W = {
  interest:      3,   // per matched tag, capped
  interestCap:   3,   // ...at 3 tags (9 pts max) so one event can't run away
  firstTimer:    2,
  sameNbhd:      2,
  worthTrip:     1,   // popular event outside your neighborhood
  soon:          1,   // happening within the soon window
  socialProof:   1,   // enough people already going
}
const WORTH_TRIP_MIN_ATTENDEES = 8   // "worth crossing the Bosphorus for"
const SOCIAL_PROOF_MIN         = 3
const SOON_WINDOW_DAYS         = 7

export type ScoreInput = {
  neighborhood: string
  isFirstTimerFriendly: boolean
  tagIds: string[]
  attendeeCount: number
  date: string          // 'YYYY-MM-DD'
}
export type ScoreContext = {
  wantedTagIds: Set<string>
  userNeighborhood: string | null
  todayStr: string
  soonCutoffStr: string
}
export type ScoreReason = {
  interestOverlap: number
  matchedTagIds: string[]
  firstTimer: boolean
  neighborhoodMatch: boolean
  worthTrip: boolean
  soon: boolean
  socialProof: boolean
  attendeeCount: number
}

/** Pure, deterministic score for one event. No I/O — unit-tested directly. */
export function scoreEvent(ev: ScoreInput, ctx: ScoreContext): { score: number; reason: ScoreReason } {
  const matchedTagIds = ev.tagIds.filter(t => ctx.wantedTagIds.has(t))
  const overlap = Math.min(matchedTagIds.length, W.interestCap)

  const neighborhoodMatch = !!ctx.userNeighborhood && ev.neighborhood === ctx.userNeighborhood
  const worthTrip = !neighborhoodMatch && ev.attendeeCount >= WORTH_TRIP_MIN_ATTENDEES
  const soon = ev.date <= ctx.soonCutoffStr           // date-only string compare (ISO)
  const socialProof = ev.attendeeCount >= SOCIAL_PROOF_MIN

  const score =
      overlap * W.interest +
      (ev.isFirstTimerFriendly ? W.firstTimer : 0) +
      (neighborhoodMatch ? W.sameNbhd : 0) +
      (worthTrip ? W.worthTrip : 0) +
      (soon ? W.soon : 0) +
      (socialProof ? W.socialProof : 0)

  return {
    score,
    reason: {
      interestOverlap: overlap,
      matchedTagIds,
      firstTimer: ev.isFirstTimerFriendly,
      neighborhoodMatch,
      worthTrip,
      soon,
      socialProof,
      attendeeCount: ev.attendeeCount,
    },
  }
}

/** Today's date in Istanbul as 'YYYY-MM-DD' (date-only → no 24:MM hazard). */
export function istanbulDateStr(offsetDays = 0): string {
  const base = new Date(Date.now() + offsetDays * 86_400_000)
  // Default-city calendar day (lib/cityTime) — per-city when nudges are.
  return dayInTz(base, DEFAULT_TZ)
}

/**
 * Attribution: stamp rsvpedAt on the member's most recent recommendation for
 * this event, if any. Best-effort side-effect — call fire-and-forget from the
 * RSVP flow (.catch(() => {})); never let it affect the RSVP outcome.
 */
export async function stampFirstEventRsvp(userId: string, eventId: string): Promise<void> {
  const rec = await prisma.eventRecommendation.findFirst({
    where: { userId, eventId, rsvpedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (rec) {
    await prisma.eventRecommendation.update({ where: { id: rec.id }, data: { rsvpedAt: new Date() } })
  }
}

export type FirstEventCard = {
  id: string
  title: string
  date: string
  time: string
  neighborhood: string
  emoji: string
  coverImage: string | null
  price: number
  spotsLeft: number
  isFirstTimerFriendly: boolean
  attendeeCount: number
  matchedTagIds: string[]
  score: number
  reason: ScoreReason
}

/**
 * Rank a member's best first events. Candidates are all upcoming, published,
 * non-full events in the member's city that they haven't already RSVP'd to —
 * scored so nearby/first-timer/relevant events float up, and popular
 * cross-neighborhood events still surface when nothing local exists.
 */
export async function getFirstEventRecommendations(userId: string, limit = 3): Promise<FirstEventCard[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { interests: true, neighborhood: true, cityId: true },
  })
  if (!user) return []

  const wanted = user.interests.length
    ? await prisma.interestTagMap.findMany({
        where: { interest: { in: user.interests } },
        select: { tagId: true },
      })
    : []
  const wantedTagIds = new Set(wanted.map(w => w.tagId))

  const todayStr = istanbulDateStr(0)
  const soonCutoffStr = istanbulDateStr(SOON_WINDOW_DAYS)

  const candidates = await prisma.event.findMany({
    where: {
      cityId: user.cityId,
      status: 'published',
      date: { gte: todayStr },          // Event.date is text 'YYYY-MM-DD'
      spotsLeft: { gt: 0 },
      attendees: { none: { userId } },  // exclude already RSVP'd
    },
    select: {
      id: true, title: true, date: true, time: true, neighborhood: true,
      emoji: true, coverImage: true, price: true, spotsLeft: true,
      isFirstTimerFriendly: true,
      tags: { select: { tagId: true } },
      // Approved only — counting pending/waitlist/cancelled RSVPs inflated the
      // "N going" social-proof score, boosting events that hadn't earned it.
      _count: { select: { attendees: { where: { status: 'approved' } } } },
    },
    orderBy: { date: 'asc' },
    take: 100,
  })

  const ctx: ScoreContext = { wantedTagIds, userNeighborhood: user.neighborhood, todayStr, soonCutoffStr }

  return candidates
    .map(ev => {
      const tagIds = ev.tags.map(t => t.tagId)
      const { score, reason } = scoreEvent(
        { neighborhood: ev.neighborhood, isFirstTimerFriendly: ev.isFirstTimerFriendly, tagIds, attendeeCount: ev._count.attendees, date: ev.date },
        ctx,
      )
      return {
        id: ev.id, title: ev.title, date: ev.date, time: ev.time, neighborhood: ev.neighborhood,
        emoji: ev.emoji, coverImage: ev.coverImage, price: ev.price, spotsLeft: ev.spotsLeft,
        isFirstTimerFriendly: ev.isFirstTimerFriendly, attendeeCount: ev._count.attendees,
        matchedTagIds: reason.matchedTagIds, score, reason,
      }
    })
    // Highest score first; break ties by soonest date so the list feels timely.
    .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
    .slice(0, limit)
}
