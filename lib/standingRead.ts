import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { STANDING_ENFORCE_SETTING, LIVE_CARD_STATUSES, standingLevel, type StandingLevel, blocksRsvp, eventTier } from '@/lib/standingPolicy'

// ── Standing, read side ─────────────────────────────────────────────────────
//
// Whether standing is switched on, and members' levels — what the RSVP paths,
// the waitlist promotion and the participant lists ask. Kept apart from
// lib/standing (the sweep and the interventions) so a join path doesn't load
// notifications and audit to answer one question.

export interface StandingEnforcement {
  enforced: boolean
  /** When enforcement was last switched on. Offences before it never make a real card. */
  since:    Date | null
}

/** Off unless an admin switched it on. An unreadable setting reads as off. Pass a transaction to read it under a lock. */
export async function standingEnforcement(db: Pick<Prisma.TransactionClient, 'appSetting'> = prisma): Promise<StandingEnforcement> {
  try {
    const row = await db.appSetting.findUnique({ where: { key: STANDING_ENFORCE_SETTING } })
    return row?.value === 'true' ? { enforced: true, since: row.updatedAt } : { enforced: false, since: null }
  } catch {
    return { enforced: false, since: null }
  }
}

/** Standing as enforcement sees it, for many members at once. Members not in the map are in good standing. */
export async function standingLevelsFor(userIds: string[], enforcement?: StandingEnforcement): Promise<Map<string, StandingLevel>> {
  const levels = new Map<string, StandingLevel>()
  if (userIds.length === 0) return levels
  const { enforced } = enforcement ?? await standingEnforcement()
  if (!enforced) return levels
  const cards = await prisma.standingCard.findMany({
    where:  { userId: { in: [...new Set(userIds)] }, shadow: false, status: { in: LIVE_CARD_STATUSES } },
    select: { userId: true, level: true, status: true, shadow: true },
  })
  const byUser = new Map<string, typeof cards>()
  for (const c of cards) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c])
  for (const [userId, list] of byUser) {
    const level = standingLevel(list, true)
    if (level !== 'good') levels.set(userId, level)
  }
  return levels
}

export async function standingLevelFor(userId: string, enforcement?: StandingEnforcement): Promise<StandingLevel> {
  return (await standingLevelsFor([userId], enforcement)).get(userId) ?? 'good'
}

/**
 * Does a red card stop this member taking a seat on this event?
 *
 * The same question the RSVP route asks, for the paths where a HOST seats
 * someone by hand — approve, add, promote. v1 enforced this through
 * getRsvpGate against a table that is now empty, so the rule had quietly
 * stopped applying to host actions while still applying to the member's own
 * tap: a rule for one button only. It loads the event's tier itself because
 * the three call sites have it in scope at different points, and one query on
 * an admin action is cheaper than three subtly different versions of this.
 */
export async function redCardBlocksSeat(userId: string, eventId: string): Promise<boolean> {
  const [level, event] = await Promise.all([
    standingLevelFor(userId),
    prisma.event.findUnique({ where: { id: eventId }, select: { limitedSpots: true, tierOverride: true } }),
  ])
  return !!event && blocksRsvp(level, eventTier(event))
}
