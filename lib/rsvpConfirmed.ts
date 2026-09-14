import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendRsvpConfirmationEmail, recordEmailFailure } from '@/lib/email'
import { noShowPolicyApplies, type StakeFields } from '@/lib/noShowPolicy'
import { DEFAULT_CURRENCY } from '@/lib/data'

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

/** Pending ledger row for the seat. Call on the join's own transaction. */
export async function createSeatPayment(tx: Prisma.TransactionClient, eventId: string, event: SeatEvent, userId: string) {
  // P6 defense-in-depth: clamp amount non-negative. Mirrors the
  // approval-required path so a misconfigured event.price
  // can't land a negative payment row in either flow.
  const safeAmount = Math.max(0, Number(event.price) || 0)
  // Same payTo guard as the approval-required path.
  if (safeAmount > 0 && event.payTo === 'smileys') {
    await tx.payment.create({
      data: { userId, eventId, amount: safeAmount, currency: event.currency ?? DEFAULT_CURRENCY, status: 'pending' },
    })
  }
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
