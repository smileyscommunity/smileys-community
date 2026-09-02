// ── No-show policy: every tunable value and every pure rule ─────────────────
//
// A no-show is a confirmed RSVP that neither came nor cancelled in time, on
// an event whose host actually ran check-in. The first within a rolling
// window is a yellow card (a warning, and a "yes, I'll come" confirmation on
// the next RSVP); the second is a red card (RSVPs and waitlists paused for a
// month, after a window to appeal). Cards are per member, across every city
// and club, and only ever come from FREE events.
//
// Client-safe on purpose (no database import): the RSVP button and the
// banner read the same rules the job applies. Anything that needs Prisma
// lives in lib/noShow.ts.

export const NO_SHOW_CANCELLATION_CUTOFF_HOURS = 12
export const NO_SHOW_ROLLING_WINDOW_DAYS       = 90
export const RED_CARD_BLOCK_DAYS               = 30
export const RED_CARD_APPEAL_WINDOW_HOURS      = 48
export const NO_SHOW_PROCESSING_DELAY_HOURS    = 2
// Launch backstop: an event that ended longer ago than this is never
// processed. Without it the first run would settle every past event in the
// database and hand out cards for things that happened before the policy
// existed.
export const NO_SHOW_PROCESSING_LOOKBACK_DAYS  = 7
// "The host ran check-in" means more than one scan. A door that checked in
// three friends and nobody else is not evidence that the other seventeen
// stayed home — it is evidence the host stopped scanning. No-shows are only
// settled when at least this share of the approved, non-staff attendees
// were checked in; below it the event waits (the host may still be
// scanning the morning after) and falls out of the window untouched.
export const NO_SHOW_MIN_CHECKIN_RATIO         = 0.5
// Day-before reconfirmation (lib/reconfirm.ts). Free, limited-spot events
// only: "still coming?" this many hours before the start; a seat that was
// asked and never answered is released to the waitlist at the cancellation
// cutoff — the same line after which a cancel would count as a no-show —
// and only when someone is actually waiting for it. Below the minimum
// lead nobody is asked: too little time to answer fairly.
export const RECONFIRM_ASK_HOURS_BEFORE        = 24
export const RECONFIRM_RELEASE_HOURS_BEFORE    = NO_SHOW_CANCELLATION_CUTOFF_HOURS
export const RECONFIRM_MIN_LEAD_HOURS          = 14

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR

export const CardKind = { Yellow: 'yellow', Red: 'red' } as const
export type CardKind = typeof CardKind[keyof typeof CardKind]

export const CardStatus = {
  Active:        'active',
  AppealPending: 'appeal_pending',
  Waived:        'waived',        // host: the attendance result was wrong
  Overturned:    'overturned',    // admin: appeal accepted
  Expired:       'expired',       // ran its course
} as const
export type CardStatus = typeof CardStatus[keyof typeof CardStatus]

/** Statuses that still count as a no-show in the rolling window. */
export const COUNTING_STATUSES: string[] = [CardStatus.Active, CardStatus.AppealPending, CardStatus.Expired]

/**
 * Was check-in run well enough to read an unchecked seat as a no-show?
 * At least one scan, and at least the policy share of the room.
 */
export function checkInIsCredible(checkedIn: number, approvedNonStaff: number): boolean {
  if (checkedIn < 1 || approvedNonStaff < 1) return false
  return checkedIn / approvedNonStaff >= NO_SHOW_MIN_CHECKIN_RATIO
}

/** Cards only ever come from free events — price 0 for members too. */
export function isFreeEvent(e: { price: number; memberPrice?: number | null }): boolean {
  return (e.price ?? 0) === 0 && (e.memberPrice == null || e.memberPrice === 0)
}

/** The last moment a cancel still counts as giving the spot back. */
export function cancellationCutoff(startsAt: Date): Date {
  return new Date(startsAt.getTime() - NO_SHOW_CANCELLATION_CUTOFF_HOURS * HOUR)
}

export interface NoShowCandidate {
  status:      string
  checkedIn:   boolean
  cancelledAt: Date | null
  cancelledBy: string | null
}

/**
 * Did this attendee no-show? Assumes the caller has already established
 * that the host ran check-in — with zero check-ins nobody is a no-show.
 *
 *   - approved and never checked in                → yes
 *   - cancelled BY THE MEMBER after the cutoff     → yes (the spot was not
 *     really given back; a host/admin removal is never held against them)
 *   - checked in, pending, removed, or cancelled in time → no
 */
export function isNoShow(a: NoShowCandidate, startsAt: Date): boolean {
  if (a.status === 'approved') return !a.checkedIn
  if (a.status === 'cancelled' && a.cancelledBy === 'member' && a.cancelledAt) {
    return a.cancelledAt.getTime() > cancellationCutoff(startsAt).getTime()
  }
  return false
}

/** Start of the rolling window that ends at `reference`. */
export function windowStart(reference: Date): Date {
  return new Date(reference.getTime() - NO_SHOW_ROLLING_WINDOW_DAYS * DAY)
}

/** First no-show in the window → yellow; any further one → red. */
export function cardKindFor(priorCountingNoShows: number): CardKind {
  return priorCountingNoShows === 0 ? CardKind.Yellow : CardKind.Red
}

/** A red card's timeline, from the moment it is issued. */
export function redCardWindows(issuedAt: Date) {
  const appealDeadlineAt    = new Date(issuedAt.getTime() + RED_CARD_APPEAL_WINDOW_HOURS * HOUR)
  const restrictionStartsAt = appealDeadlineAt
  const restrictionEndsAt   = new Date(restrictionStartsAt.getTime() + RED_CARD_BLOCK_DAYS * DAY)
  return { appealDeadlineAt, restrictionStartsAt, restrictionEndsAt }
}

/** When a rejected appeal lets the block begin: never before the deadline. */
export function restrictionAfterRejectedAppeal(appealDeadlineAt: Date, resolvedAt: Date) {
  const restrictionStartsAt = new Date(Math.max(appealDeadlineAt.getTime(), resolvedAt.getTime()))
  const restrictionEndsAt   = new Date(restrictionStartsAt.getTime() + RED_CARD_BLOCK_DAYS * DAY)
  return { restrictionStartsAt, restrictionEndsAt }
}

// ── The RSVP gate ───────────────────────────────────────────────────────────

export interface GateCard {
  id:                  string
  kind:                string
  status:              string
  eventId:             string
  occurredAt:          Date
  acknowledgedAt:      Date | null
  appealDeadlineAt:    Date | null
  restrictionStartsAt: Date | null
  restrictionEndsAt:   Date | null
}

export type GateResult =
  | { ok: true }
  | { ok: false; code: 'red_card_blocked';    cardId: string; restrictionEndsAt: Date; appealDeadlineAt: Date | null }
  | { ok: false; code: 'yellow_ack_required'; cardId: string; eventId: string }

/** Is this red card's block in force right now? */
export function isBlocking(card: GateCard, now: Date): boolean {
  return card.kind === CardKind.Red
    && card.status === CardStatus.Active
    && !!card.restrictionStartsAt && !!card.restrictionEndsAt
    && card.restrictionStartsAt.getTime() <= now.getTime()
    && now.getTime() < card.restrictionEndsAt.getTime()
}

/** Does this yellow card still want its "I'll actually come" confirmation? */
export function needsAcknowledgement(card: GateCard, now: Date): boolean {
  return card.kind === CardKind.Yellow
    && card.status === CardStatus.Active
    && card.acknowledgedAt === null
    && card.occurredAt.getTime() >= windowStart(now).getTime()
}

/**
 * May this member RSVP or join a waitlist right now? A block wins over a
 * pending confirmation; with several blocks the one ending last is reported.
 */
export function evaluateGate(cards: GateCard[], now: Date = new Date()): GateResult {
  const blocking = cards.filter(c => isBlocking(c, now))
    .sort((a, b) => b.restrictionEndsAt!.getTime() - a.restrictionEndsAt!.getTime())[0]
  if (blocking) {
    return { ok: false, code: 'red_card_blocked', cardId: blocking.id,
             restrictionEndsAt: blocking.restrictionEndsAt!, appealDeadlineAt: blocking.appealDeadlineAt }
  }
  const yellow = cards.filter(c => needsAcknowledgement(c, now))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0]
  if (yellow) return { ok: false, code: 'yellow_ack_required', cardId: yellow.id, eventId: yellow.eventId }
  return { ok: true }
}
