import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendSpotOpenedEmail, recordEmailFailure } from '@/lib/email'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { hasQuotaRoomFor, quotaEventSelect } from '@/lib/eventQuota'
import { claimOnce, rateLimit, releaseClaim } from '@/lib/rateLimit'

// Per-member throttle. Every join/cancel cycle on a busy event re-ran the
// fan-out, and one waitlister got 11 identical "claim it!" alerts in a day.
// The claim is per SEAT, not per event: the seat is the member who gave it
// back (EventAttendee is unique per user+event, so their id names the seat).
// A per-event claim silenced a genuinely new seat for six hours — seat A at
// 17:00 alerted and was claimed, seat B at 18:30 for a 20:00 event told
// nobody and sat empty. The same member cancelling, rejoining and cancelling
// again is still one alert per window; the daily cap bounds everything else.
export const SPOT_ALERT_SEAT_WINDOW_MS         = 6 * 3_600_000
// A caller that can't name the seat falls back to a short per-event window,
// so an unknown second seat waits minutes, not hours.
export const SPOT_ALERT_UNKNOWN_SEAT_WINDOW_MS = 30 * 60_000
export const SPOT_ALERT_DAILY_CAP             = 5
const DAY_MS = 86_400_000

async function mayAlert(userId: string, eventId: string, seats: string[]): Promise<boolean> {
  const keys = seats.length
    ? seats.map(s => ({ key: `spot-opened:${userId}:${eventId}:${s}`, ms: SPOT_ALERT_SEAT_WINDOW_MS }))
    : [{ key: `spot-opened:${userId}:${eventId}`, ms: SPOT_ALERT_UNKNOWN_SEAT_WINDOW_MS }]
  try {
    // One fan-out can carry several seats (the reconfirm release): alert if
    // any of them is news to this member.
    const fresh: string[] = []
    for (const k of keys) if (await claimOnce(k.key, k.ms)) fresh.push(k.key)
    if (fresh.length === 0) return false
    if (await rateLimit(`spot-opened-daily:${userId}`, SPOT_ALERT_DAILY_CAP, DAY_MS)) return true
    // Capped: hand the seat claims back, or an alert that never went out
    // would silence those seats for the member for the whole window.
    for (const key of fresh) await releaseClaim(key)
    return false
  } catch (e) {
    // Fail open: a missed open seat costs the member more than one extra alert.
    console.error('[spot-opened] throttle check failed, alerting anyway', { userId, eventId, err: String(e) })
    return true
  }
}

/**
 * A seat just came free: tell everyone on the waitlist and let the first
 * to tap Join take it (the claim itself is the gated, race-safe RSVP POST).
 * Deliberately not an auto-promotion — a member who actively claims a spot
 * is far likelier to turn up than one silently handed it, which is why the
 * cancel path replaced auto-promote with this in the first place. Used by
 * the member's own cancel and by the day-before reconfirmation release.
 *
 * Re-derives spotsLeft afterwards so the event page shows the open seat.
 * `releasedUserIds` are the members whose seats just opened — the throttle's
 * seat identity (see mayAlert).
 */
export async function announceSpotOpened(eventId: string, releasedUserIds: string[] = []): Promise<number> {
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
    // Quota first, so a closed side never spends the member's throttle.
    if ((await hasQuotaRoomFor(eventId, event, u)).ok && await mayAlert(u.id, eventId, releasedUserIds)) users.push(u)
  }

  for (const u of users) {
    // One push, from the notification itself: createNotification pushes
    // every type it doesn't gate ('spot_opened' has no preference key), and
    // a second sendPushToUser here buzzed each waitlister twice per seat.
    createNotification(
      u.id,
      'spot_opened',
      'Spot opened — claim it! 🚪',
      `A spot just opened for "${event.title}". First come, first served.`,
      `/events/${eventId}`,
    ).catch(() => {})
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
