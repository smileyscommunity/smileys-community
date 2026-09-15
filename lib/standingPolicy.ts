import { Attendance, AttendeeStatus } from '@/lib/constants'
import { noShowExemptionReason, RECONFIRM_RELEASE_HOURS_BEFORE, type EventRunners } from '@/lib/noShowPolicy'

// ── Standing: every tunable value and every pure rule ───────────────────────
//
// Standing measures one thing: can Smileys rely on you when you commit. It
// replaces the v1 no-show cards, which read an unscanned seat as a no-show and
// issued 95 cards that were all reversed. Here a no-show is only what a host
// declares (lib/attendanceCloseOut); an RSVP nobody resolved is attended.
//
//   - An offence is a no-show or a late cancellation. It is carded only on a
//     SCARCE event (a lost seat, or a promise to a venue), and not in a city's
//     first 90 days; everything else is logged.
//   - Two counting offences inside 90 days: yellow. One more while yellow: red.
//   - A yellow clears after two successful commitments; a red, after three,
//     becomes eligible for an admin's review — the review is the clearance.
//   - Effects never block an open event: recovery needs attending things.
//
// Client-safe on purpose (no database import): the member page and the admin
// queue read the same rules the sweep applies. Anything that needs Prisma
// lives in lib/standing.ts.

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR

export const SCARCE_MAX_CAPACITY           = 20
export const STANDING_WINDOW_DAYS          = 90
export const YELLOW_AFTER_OFFENCES         = 2
export const YELLOW_CLEARS_AT_COMMITMENTS  = 2
export const RED_REVIEW_AT_ATTENDANCES     = 3
// At most one of a yellow card's commitments may be hosting or volunteering.
export const MAX_CONTRIBUTIONS_PER_YELLOW  = 1
export const CARD_LAPSE_DAYS               = 90
export const NEW_CITY_GRACE_DAYS           = 90
// An RSVP nobody marked is resolved as attended this long after the end. It is
// also when a host's close-out and the check-in prompt stop: after it the
// room's attendance is settled.
export const ATTENDANCE_AUTO_RESOLVE_HOURS = 24
export const DISPUTE_WINDOW_DAYS           = 30
// How far back the sweep reads events. Wider than the resolve delay so a
// missed run (or a week-long outage) catches up.
export const STANDING_SWEEP_LOOKBACK_DAYS  = 14
// Standing starts clean. Events that started before this are never read for
// offences, so nothing from v1 — whose every card was reversed — carries over.
export const STANDING_STARTS_AT            = new Date('2026-09-16T00:00:00Z')
// A commitment has to be seen: a door scan, not an RSVP nobody resolved.
// Host inaction never makes a penalty, and it doesn't earn credit either.
export const RECOVERY_REQUIRES_CHECKIN     = true
// AppSetting key. 'true' turns on what members see and feel: notifications,
// the waitlist order, host approval for red cards on scarce events.
export const STANDING_ENFORCE_SETTING      = 'standing.enforce'

export const Tier = { Scarce: 'scarce', Open: 'open' } as const
export type Tier = typeof Tier[keyof typeof Tier]

export const CANCEL_CUTOFF_HOURS: Record<Tier, number> = { scarce: 24, open: 2 }

export const OffenceKind = { NoShow: 'no_show', LateCancel: 'late_cancel' } as const
export type OffenceKind = typeof OffenceKind[keyof typeof OffenceKind]

export const OffenceStatus = {
  Open:       'open',
  Disputed:   'disputed',     // "I was there" — waiting on a moderator
  Overturned: 'overturned',   // a moderator, or a later check-in, said they came
  Forgiven:   'forgiven',     // reserved for a human pardon
} as const

export const CardLevel = { Yellow: 'yellow', Red: 'red' } as const
export type CardLevel = typeof CardLevel[keyof typeof CardLevel]

export const StandingCardStatus = {
  Active:    'active',
  Review:    'review',      // red with its commitments done: waiting on an admin
  Cleared:   'cleared',     // yellow recovered
  Restored:  'restored',    // red restored by an admin
  Lapsed:    'lapsed',      // no RSVP activity for CARD_LAPSE_DAYS
  Escalated: 'escalated',   // yellow that became a red
  Withdrawn: 'withdrawn',   // the offence under it was overturned
} as const

/** Cards that still shape a member's standing. */
export const LIVE_CARD_STATUSES: string[] = [StandingCardStatus.Active, StandingCardStatus.Review]

export type StandingLevel = 'good' | CardLevel

// ── Tier and cutoff ─────────────────────────────────────────────────────────

export interface TierFields {
  limitedSpots?:      boolean | null
  totalSpots?:        number | null
  tierOverride?:      string | null
  cancelCutoffHours?: number | null
}

export function isTier(v: unknown): v is Tier {
  return v === Tier.Scarce || v === Tier.Open
}

/** Scarce when a host flagged it, or when seats are capped at 20 or fewer. */
export function eventTier(e: TierFields): Tier {
  if (isTier(e.tierOverride)) return e.tierOverride
  return e.limitedSpots && typeof e.totalSpots === 'number' && e.totalSpots <= SCARCE_MAX_CAPACITY
    ? Tier.Scarce : Tier.Open
}

export function cancelCutoffHours(e: TierFields): number {
  return typeof e.cancelCutoffHours === 'number' && e.cancelCutoffHours >= 0
    ? e.cancelCutoffHours : CANCEL_CUTOFF_HOURS[eventTier(e)]
}

/** The last moment a member's cancel still gives the seat back in time. */
export function lateCancelLine(startsAt: Date, e: TierFields): Date {
  return new Date(startsAt.getTime() - cancelCutoffHours(e) * HOUR)
}

// ── What an RSVP row was ────────────────────────────────────────────────────

export interface StandingRow {
  id:                string
  userId:            string
  status:            string
  checkedIn:         boolean
  attendance:        string
  joinedAt:          Date
  cancelledAt:       Date | null
  cancelledBy:       string | null
  reconfirmAskedAt?: Date | null
  cancelledLate?:    boolean | null
  user?:             { role: string } | null
}

/**
 * Was a member's cancel late? After the tier's cutoff, unless it answered the
 * day-before "still coming?" before the release point. The RSVP route records
 * this on the row at the moment of the cancel (EventAttendee.cancelledLate).
 */
export function isLateCancel(cancelledAt: Date, startsAt: Date, e: TierFields, reconfirmAskedAt: Date | null): boolean {
  const at = cancelledAt.getTime()
  if (at <= lateCancelLine(startsAt, e).getTime()) return false
  if (reconfirmAskedAt && at <= startsAt.getTime() - RECONFIRM_RELEASE_HOURS_BEFORE * HOUR) return false
  return true
}

/**
 * The offence this row is, once the event has resolved — or null.
 *
 *   - checked in, or running the event / staff          → nothing
 *   - approved and declared a no-show by the host        → no_show
 *   - cancelled BY THE MEMBER after the tier's cutoff    → late_cancel, unless
 *     it answered the day-before "still coming?" before the release point:
 *     that ask comes after a scarce event's 24h cutoff, and saying no is
 *     exactly what it asks for
 *   - removed by a host, an admin or the reconfirm release → never
 */
export function classifyRow(row: StandingRow, startsAt: Date, e: TierFields, runners: EventRunners): OffenceKind | null {
  if (row.checkedIn) return null
  if (noShowExemptionReason(row.userId, row.user?.role, runners)) return null
  if (row.status === AttendeeStatus.Approved) {
    return row.attendance === Attendance.NoShow ? OffenceKind.NoShow : null
  }
  if (row.status === AttendeeStatus.Cancelled && row.cancelledBy === 'member' && row.cancelledAt) {
    // Decided when the member cancelled, against the event as it stood then:
    // a tier, cutoff or time edited afterwards must not make an on-time cancel
    // late (or a late one on time). Rows from before that was recorded are
    // judged against the event now.
    const late = row.cancelledLate ?? isLateCancel(row.cancelledAt, startsAt, e, row.reconfirmAskedAt ?? null)
    return late ? OffenceKind.LateCancel : null
  }
  return null
}

/**
 * Late cancels whose seat someone else then used: forgiven. The harm the rule
 * prices is the lost seat, and if a member who joined after the cancel came,
 * there was none. One arrival covers one cancel, earliest first. Without this
 * a late cancel costs exactly what silence costs, and nobody would cancel.
 */
export function refilledLateCancels(
  lateCancels: { id: string; cancelledAt: Date }[],
  arrivals:    { joinedAt: Date; checkedIn: boolean }[],
): Set<string> {
  const joins = arrivals.filter(a => a.checkedIn).map(a => a.joinedAt.getTime()).sort((a, b) => a - b)
  const forgiven = new Set<string>()
  let j = 0
  for (const lc of [...lateCancels].sort((a, b) => a.cancelledAt.getTime() - b.cancelledAt.getTime())) {
    while (j < joins.length && joins[j] <= lc.cancelledAt.getTime()) j++
    if (j < joins.length) { forgiven.add(lc.id); j++ }
  }
  return forgiven
}

export type LoggedReason = 'open_tier' | 'new_city'

/** Does an offence count toward a card, and if not, why. */
export function offenceCounts(tier: Tier, cityCreatedAt: Date | null, occurredAt: Date): { counts: boolean; loggedReason: LoggedReason | null } {
  if (tier !== Tier.Scarce) return { counts: false, loggedReason: 'open_tier' }
  // A new city's events are nearly all small, so nearly all scarce: a founding
  // member there would be carded faster than an Istanbul member behaving
  // identically, with fewer open events to recover on.
  if (cityCreatedAt && occurredAt.getTime() - cityCreatedAt.getTime() < NEW_CITY_GRACE_DAYS * DAY) {
    return { counts: false, loggedReason: 'new_city' }
  }
  return { counts: true, loggedReason: null }
}

// ── Issuance ────────────────────────────────────────────────────────────────

export interface LedgerOffence {
  id:         string
  occurredAt: Date
  counts:     boolean
  status:     string
  cardId:     string | null
}

export interface LiveCard {
  id:          string
  level:       string
  status:      string
  triggeredAt: Date
}

export type IssueDecision =
  | { kind: 'none' }
  | { kind: 'yellow';   offenceIds: string[]; triggeredAt: Date }
  | { kind: 'escalate'; fromCardId: string; offenceIds: string[]; triggeredAt: Date }
  | { kind: 'attach';   cardId: string; offenceIds: string[] }

export function windowStart(now: Date): Date {
  return new Date(now.getTime() - STANDING_WINDOW_DAYS * DAY)
}

/**
 * The next card step for a member, from their ledger. Applied repeatedly
 * until 'none', so a batch holding three offences reads as yellow, then red.
 * Offences already on a card never count again. A member with a dispute
 * waiting is not carded until it is resolved.
 */
export function decideIssuance(offences: LedgerOffence[], live: LiveCard | null, now: Date, disputePending: boolean): IssueDecision {
  if (disputePending) return { kind: 'none' }
  const loose = offences
    .filter(o => o.counts && o.status === OffenceStatus.Open && !o.cardId && o.occurredAt.getTime() >= windowStart(now).getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  if (!live) {
    if (loose.length < YELLOW_AFTER_OFFENCES) return { kind: 'none' }
    const issued = loose.slice(0, YELLOW_AFTER_OFFENCES)
    return { kind: 'yellow', offenceIds: issued.map(o => o.id), triggeredAt: issued[issued.length - 1].occurredAt }
  }
  const after = loose.filter(o => o.occurredAt.getTime() > live.triggeredAt.getTime())
  if (after.length === 0) return { kind: 'none' }
  if (live.level === CardLevel.Yellow && live.status === StandingCardStatus.Active) {
    return { kind: 'escalate', fromCardId: live.id, offenceIds: [after[0].id], triggeredAt: after[0].occurredAt }
  }
  // A red (or a yellow already waiting on something else) keeps further
  // offences on its record without stacking another card.
  return { kind: 'attach', cardId: live.id, offenceIds: after.map(o => o.id) }
}

// ── Recovery ────────────────────────────────────────────────────────────────

export interface RecoveryTally {
  attendance:    number
  contributions: number
}

/** Does this RSVP count toward clearing the card? */
export function isSuccessfulCommitment(
  row: { status: string; checkedIn: boolean; attendance: string },
  startsAt: Date, endsAt: Date, card: { triggeredAt: Date }, now: Date,
): boolean {
  if (row.status !== AttendeeStatus.Approved) return false
  if (startsAt.getTime() <= card.triggeredAt.getTime()) return false
  if (endsAt.getTime() > now.getTime()) return false
  return RECOVERY_REQUIRES_CHECKIN ? row.checkedIn : (row.checkedIn || row.attendance === Attendance.Attended)
}

/** Commitments that count, with contributions capped for a yellow. */
export function countedCommitments(level: string, t: RecoveryTally): number {
  if (level === CardLevel.Red) return t.attendance
  return t.attendance + Math.min(t.contributions, MAX_CONTRIBUTIONS_PER_YELLOW)
}

export function commitmentsNeeded(level: string): number {
  return level === CardLevel.Red ? RED_REVIEW_AT_ATTENDANCES : YELLOW_CLEARS_AT_COMMITMENTS
}

/** Where a live card goes once its commitments are in: cleared, up for review, or nowhere yet. */
export function recoveryOutcome(card: { level: string; status: string }, t: RecoveryTally): 'cleared' | 'review' | null {
  if (card.status !== StandingCardStatus.Active) return null
  if (countedCommitments(card.level, t) < commitmentsNeeded(card.level)) return null
  return card.level === CardLevel.Red ? 'review' : 'cleared'
}

/**
 * A card with no RSVP activity for CARD_LAPSE_DAYS lapses. Without an expiry,
 * penalised and dormant look the same, and going quiet keeps a card forever.
 */
export function cardLapsed(card: { issuedAt: Date }, lastActivityAt: Date | null, now: Date): boolean {
  const since = Math.max(card.issuedAt.getTime(), lastActivityAt?.getTime() ?? 0)
  return now.getTime() - since > CARD_LAPSE_DAYS * DAY
}

// ── Effects ─────────────────────────────────────────────────────────────────

/** A member's standing as enforcement sees it: shadow cards never count. */
export function standingLevel(cards: { level: string; status: string; shadow: boolean }[], enforce: boolean): StandingLevel {
  if (!enforce) return 'good'
  const live = cards.filter(c => !c.shadow && LIVE_CARD_STATUSES.includes(c.status))
  if (live.some(c => c.level === CardLevel.Red)) return CardLevel.Red
  if (live.some(c => c.level === CardLevel.Yellow)) return CardLevel.Yellow
  return 'good'
}

/** A red card's seat on a scarce event is the host's call. */
export function needsHostApproval(level: StandingLevel, tier: Tier): boolean {
  return level === CardLevel.Red && tier === Tier.Scarce
}

/**
 * A scarce event's waitlist, good standing first, each group first-come.
 * Open events keep plain first-come order.
 */
export function orderWaitlist<T extends { userId: string }>(queue: T[], levels: Map<string, StandingLevel>, tier: Tier): T[] {
  if (tier !== Tier.Scarce) return queue
  const good = queue.filter(q => (levels.get(q.userId) ?? 'good') === 'good')
  const back = queue.filter(q => (levels.get(q.userId) ?? 'good') !== 'good')
  return [...good, ...back]
}

// ── Disputes ────────────────────────────────────────────────────────────────

/**
 * "I was there" is for a declared no-show, open, and recent. A late cancel is a
 * timestamp. One dispute per offence: a pending dispute holds cards back, so an
 * upheld one that could be reopened would hold them back for good.
 */
export function canDispute(o: { kind: string; status: string; occurredAt: Date; disputedAt?: Date | null }, now: Date): boolean {
  return o.kind === OffenceKind.NoShow
    && o.status === OffenceStatus.Open
    && !o.disputedAt
    && now.getTime() - o.occurredAt.getTime() <= DISPUTE_WINDOW_DAYS * DAY
}
