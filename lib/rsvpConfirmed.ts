import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendRsvpConfirmationEmail, recordEmailFailure } from '@/lib/email'
import { noShowPolicyApplies, type StakeFields } from '@/lib/noShowPolicy'
import { DEFAULT_CURRENCY } from '@/lib/data'
import { todayInCity } from '@/lib/city'

// What a confirmed seat sets in motion, shared by every member path that
// lands one: the straight RSVP and the waitlist claim. The claim used to
// hand-roll a shorter list — no payment row, no host notice, no
// confirmation email — so a member who took an opened seat on a paid event
// owed nothing on the ledger and the host never heard they were coming.
// Moved verbatim from app/api/events/[id]/rsvp/route.ts.

export type SeatEvent = StakeFields & {
  title: string; date: string; cityId: string; hostId: string | null
  location: string | null; neighborhood: string | null; currency: string | null
}

/** Ledger rows that still stand for a seat: owed or settled. Cancelled, refunded and failed are history. */
export const LIVE_PAYMENT_STATUSES: string[] = ['pending', 'paid']

/** The fields that decide what a seat owes. */
export type SeatPaymentEvent = Pick<SeatEvent, 'price' | 'payTo' | 'currency' | 'hostId'>

/** Does money for this event flow through Smileys? Venue-paid and free events keep no ledger. */
export function collectsSeatPayment(event: Pick<StakeFields, 'price' | 'payTo'>): boolean {
  return Math.max(0, Number(event.price) || 0) > 0 && event.payTo === 'smileys'
}

/**
 * Pending ledger row for the seat, unless one already stands. Call on the
 * seat's own transaction. Returns whether a row was written.
 *
 * Only the straight RSVP and the waitlist claim used to write one. A host
 * approve, a manual add, a waitlist promotion and a restored event seated
 * people with nothing owed, and the sweep's backfill only reached events two
 * days out — the 2026-09 audit found 59 approved seats with no live payment.
 * Every seat path now comes through here, so a second call must be a no-op:
 * a member re-joining while an earlier row is still paid, or a request whose
 * row survived to approval, never gets a second live charge.
 */
export async function createSeatPayment(tx: Prisma.TransactionClient, eventId: string, event: SeatPaymentEvent, userId: string): Promise<boolean> {
  if (!collectsSeatPayment(event)) return false
  // Staff take no seat and owe nothing — the sweep and lib/spotsLeft agree.
  if (event.hostId === userId) return false
  // No unique key can say "one live row per seat", so two writers for the
  // same seat (the hourly backfill and a host's approve) queue on a per-seat
  // lock held to the end of the transaction, then read. The void result
  // stays inside the subquery: Prisma can't deserialize a void column.
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${eventId}), hashtext(${userId}))) AS l`
  const live = await tx.payment.findFirst({ where: { eventId, userId, status: { in: LIVE_PAYMENT_STATUSES } }, select: { id: true } })
  if (live) return false
  const cohost = await tx.eventCoHost.findFirst({ where: { eventId, userId }, select: { id: true } })
  if (cohost) return false
  // P6 defense-in-depth: clamp amount non-negative, so a misconfigured
  // event.price can't land a negative payment row.
  await tx.payment.create({
    data: { userId, eventId, amount: Math.max(0, Number(event.price) || 0), currency: event.currency ?? DEFAULT_CURRENCY, status: 'pending' },
  })
  return true
}

/**
 * Ledger rows for every approved seat on an upcoming Smileys-collected event
 * that has none — for when collection starts after people joined (a price or
 * payTo edit, a restored event) and for the payment sweep. Idempotent;
 * returns how many rows it wrote.
 *
 * A seat on an event that has already happened is not billed after the fact
 * here: that is a product call (scripts/audit-seats-without-payment.ts lists
 * them).
 */
export async function backfillSeatPayments(eventId: string): Promise<number> {
  const event = await prisma.event.findUnique({
    where:  { id: eventId },
    select: { price: true, payTo: true, currency: true, hostId: true, date: true, cityId: true },
  })
  if (!event || !collectsSeatPayment(event)) return 0
  if (event.date < await todayInCity(event.cityId)) return 0

  const [seats, live] = await Promise.all([
    prisma.eventAttendee.findMany({ where: { eventId, status: 'approved' }, select: { userId: true } }),
    prisma.payment.findMany({ where: { eventId, status: { in: LIVE_PAYMENT_STATUSES } }, select: { userId: true } }),
  ])
  const covered = new Set(live.map(p => p.userId))
  let created = 0
  for (const { userId } of seats) {
    if (covered.has(userId)) continue
    // Re-read the seat on the write's transaction: someone who gave the spot
    // back since the list was read gets no charge for it.
    const made = await prisma.$transaction(async tx => {
      const seat = await tx.eventAttendee.findFirst({ where: { eventId, userId, status: 'approved' }, select: { id: true } })
      return seat ? createSeatPayment(tx, eventId, event, userId) : false
    })
    if (made) created++
  }
  return created
}

/** Confirmation email + host notification (fire-and-forget). */
export function announceConfirmedSeat(userId: string, eventId: string, event: SeatEvent): void {
  ;(async () => {
    const [user, city] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
      prisma.city.findUnique({ where: { id: event.cityId }, select: { name: true } }),
    ])
    if (user) {
      sendRsvpConfirmationEmail(
        user.email, user.name ?? 'Member',
        event.title, event.date,
        event.location ?? event.neighborhood ?? city?.name ?? 'your city',
        eventId,
        { free: noShowPolicyApplies(event) },
      ).catch(async err => {
        console.error('[rsvp POST] sendRsvpConfirmationEmail failed', { userId, eventId, err: String(err) })
        await recordEmailFailure({ helper: 'sendRsvpConfirmationEmail', recipient: user.email, error: err, context: { userId, eventId } })
      })
    }
    if (event.hostId) {
      createNotification(
        event.hostId,
        'attendee_joined',
        'New RSVP 🎉',
        `${user?.name ?? 'A member'} just signed up for "${event.title}"`,
        `/host/events/${eventId}/participants`,
      )
    }
  })()
}
