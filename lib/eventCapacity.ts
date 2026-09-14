import type { Prisma, PrismaClient } from '@prisma/client'
import { OVER_CAPACITY_CODE, BELOW_APPROVED_CODE, OVERRIDE_FLAG } from '@/lib/admin/overCapacity'

// ── Seat capacity for the staff doors ───────────────────────────────────────
//
// A limited event's cap lived only in the member RSVP path (spotsLeft > 0,
// under a row lock). Staff approve, add, promote and the promotion after a
// removal seated people with no count at all, and an edit could set totalSpots
// under the people already seated — 13 limited events in production ended up
// with more approved seats than spots.
//
// Every staff door now counts under the same row lock the RSVP path takes and
// refuses past the cap unless the request says `allowOverCapacity: true`
// (lib/admin/overCapacity: the page sends it only after a confirm). Seats are
// counted the way lib/spotsLeft counts them: approved, host and co-hosts
// excluded. An unlimited event has no cap to enforce.

type Db = PrismaClient | Prisma.TransactionClient

export { OVER_CAPACITY_CODE, BELOW_APPROVED_CODE, OVERRIDE_FLAG }

/** Did the caller explicitly ask to go over capacity? Only a literal `true` counts. */
export function wantsOverCapacity(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>)[OVERRIDE_FLAG] === true
}

/** Serialises every seat change on one event (the RSVP route takes the same lock). */
export async function lockEventRow(db: Db, eventId: string): Promise<void> {
  await db.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`
}

export interface SeatState {
  limited:    boolean
  totalSpots: number
  approved:   number        // approved non-staff seats; 0 when not limited (never counted)
  staffIds:   string[]
}

/** Approved seats that count against the cap: host and co-hosts take none. */
export async function approvedSeatCount(db: Db, eventId: string, staffIds: string[]): Promise<number> {
  const n = await db.eventAttendee.count({
    where: { eventId, status: 'approved', ...(staffIds.length ? { NOT: { userId: { in: staffIds } } } : {}) },
  })
  return Number(n) || 0
}

/** The event's cap and current seats. Call under lockEventRow for a count that holds. */
export async function seatState(db: Db, eventId: string, opts: { countEvenIfUnlimited?: boolean } = {}): Promise<SeatState | null> {
  const ev = await db.event.findUnique({
    where:  { id: eventId },
    select: { hostId: true, limitedSpots: true, totalSpots: true, cohosts: { select: { userId: true } } },
  })
  if (!ev) return null
  const staffIds = [...new Set([ev.hostId, ...(ev.cohosts ?? []).map(c => c.userId)].filter(Boolean) as string[])]
  const limited  = ev.limitedSpots === true
  const approved = limited || opts.countEvenIfUnlimited ? await approvedSeatCount(db, eventId, staffIds) : 0
  return { limited, totalSpots: ev.totalSpots, approved, staffIds }
}

export type CapacityVerdict = { ok: true } | { ok: false; approved: number; totalSpots: number }

/** Pure: may `adding` more seats be given? Unlimited events always may. */
export function seatVerdict(s: { limited: boolean; totalSpots: number; approved: number }, adding = 1): CapacityVerdict {
  if (!s.limited || s.approved + adding <= s.totalSpots) return { ok: true }
  return { ok: false, approved: s.approved, totalSpots: s.totalSpots }
}

/**
 * Pure: may an edit move the cap to `to`? Refused only when the edit TIGHTENS
 * it (a lower totalSpots, or limited switched on) below the seats already
 * held. An event that is already over and whose cap isn't tightened can still
 * be edited — blocking every unrelated save on it would help nobody.
 */
export function shrinkVerdict(s: {
  approved: number
  from: { totalSpots: number; limited: boolean }
  to:   { totalSpots: number; limited: boolean }
}): CapacityVerdict {
  if (!s.to.limited) return { ok: true }
  const tightened = s.to.totalSpots < s.from.totalSpots || !s.from.limited
  if (!tightened || s.approved <= s.to.totalSpots) return { ok: true }
  return { ok: false, approved: s.approved, totalSpots: s.to.totalSpots }
}

/** 409 body for a staff seat past the cap. */
export function overCapacityBody(v: { approved: number; totalSpots: number }) {
  return {
    error:      `This event is full — ${v.approved} of ${v.totalSpots} seats are taken. Confirm to seat them over capacity.`,
    code:       OVER_CAPACITY_CODE,
    approved:   v.approved,
    totalSpots: v.totalSpots,
  }
}

/** 400 body for an edit that would put the cap under the seats already held. */
export function belowApprovedBody(v: { approved: number; totalSpots: number }, label?: string) {
  return {
    error:      `${label ? `${label}: ` : ''}${v.approved} member${v.approved === 1 ? ' already holds a seat' : 's already hold seats'} — total spots can't go below ${v.approved} (asked for ${v.totalSpots}) unless you confirm going over capacity.`,
    code:       BELOW_APPROVED_CODE,
    approved:   v.approved,
    totalSpots: v.totalSpots,
  }
}
