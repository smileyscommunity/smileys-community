import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendPushToUser } from '@/lib/push'
import { sendSpotOpenedEmail, recordEmailFailure } from '@/lib/email'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { hasQuotaRoomFor, quotaEventSelect } from '@/lib/eventQuota'

/**
 * A seat just came free: tell everyone on the waitlist and let the first
 * to tap Join take it (the claim itself is the gated, race-safe RSVP POST).
 * Deliberately not an auto-promotion — a member who actively claims a spot
 * is far likelier to turn up than one silently handed it, which is why the
 * cancel path replaced auto-promote with this in the first place. Used by
 * the member's own cancel and by the day-before reconfirmation release.
 *
 * Re-derives spotsLeft afterwards so the event page shows the open seat.
 */
export async function announceSpotOpened(eventId: string): Promise<number> {
  const event = await prisma.event.findUnique({
    where:  { id: eventId },
    select: { title: true, date: true, soldOut: true, limitedSpots: true, ...quotaEventSelect },
  })
  if (!event) return 0

  // Recompute first, never a blind +1: hosts and co-hosts join without
  // consuming a spot, so their cancel must not mint one, and the derived
  // value can't creep past totalSpots on repeated join/cancel cycles.
  await recomputeSpotsLeft(eventId, event.totalSpots)

  // Nothing to claim, nothing to announce. The claim path refuses a
  // manually sold-out event and a seat the member's side can't take, so an
  // urgent "claim it!" to those people only produced a 409 on tap.
  if (event.soldOut) return 0
  if (event.limitedSpots) {
    const fresh = await prisma.event.findUnique({ where: { id: eventId }, select: { spotsLeft: true } })
    if ((fresh?.spotsLeft ?? 0) <= 0) return 0
  }

  // WaitlistEntry has no FK relation to User, so the members come in one
  // batched lookup after the entries.
  const entries = await prisma.waitlistEntry.findMany({
    where:   { eventId },
    orderBy: { createdAt: 'asc' },
    select:  { userId: true },
  })
  const candidates = entries.length
    ? await prisma.user.findMany({
        where:  { id: { in: entries.map(w => w.userId) } },
        select: { id: true, name: true, email: true, gender: true, nationality: true },
      })
    : []
  const users: typeof candidates = []
  for (const u of candidates) {
    if ((await hasQuotaRoomFor(eventId, event, u)).ok) users.push(u)
  }

  for (const u of users) {
    createNotification(
      u.id,
      'spot_opened',
      'Spot opened — claim it! 🚪',
      `A spot just opened for "${event.title}". First come, first served.`,
      `/events/${eventId}`,
    ).catch(() => {})
    sendPushToUser(u.id, {
      title: 'Spot opened! 🚪',
      body:  `Quick — a spot opened for "${event.title}". First come first served.`,
      link:  `/app/events/${eventId}`,
    }).catch(() => {})
    // Fire-and-forget so a single SMTP failure doesn't block other
    // members' notifications or the caller's response.
    sendSpotOpenedEmail(u.email, u.name ?? 'Member', event.title, event.date ?? '', eventId)
      .catch(async err => {
        console.error('[spot-opened] sendSpotOpenedEmail failed', { userId: u.id, eventId, err: String(err) })
        await recordEmailFailure({ helper: 'sendSpotOpenedEmail', recipient: u.email, error: err, context: { userId: u.id, eventId } })
      })
  }

  return users.length
}
