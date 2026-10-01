// ── Cross-city trips, phase 3: "add <city> to your cities" ───────────────────
//
// A trip from Istanbul to Eskişehir is how a young city gets members who have
// actually been there. The day after, everyone who went gets one message: add
// Eskişehir as one of your cities, and you'll hear about its events. It links
// to the city page, whose hero carries the one-tap Join button (lib/cityMembership
// joinCity — approved members, live cities, idempotent).
//
// Sent from the post-event survey sweep (app/api/cron/sweep-event-surveys), to
// the same people who get the survey: approved attendees who weren't marked
// no-show or excused — plus the host and co-hosts, who travelled too. Anyone
// whose home is already that city, or who has already joined it, is skipped.
// One message per person per trip (claimOnce).

import { prisma } from './prisma'
import { claimOnce } from './rateLimit'
import { createNotification } from './notify'

/** Who to invite: the trip's people, minus anyone already in the city. */
export function tripCityInvitees(travellerIds: string[], alreadyInCity: Set<string>): string[] {
  return [...new Set(travellerIds)].filter(id => !alreadyInCity.has(id))
}

export function tripCityInviteMessage(cityName: string): { title: string; body: string } {
  return {
    title: `You've been to ${cityName} 🚆`,
    body:  `Add ${cityName} to your cities to hear about events there — and meet the people you met again.`,
  }
}

/**
 * Invite a finished trip's travellers to join its city. Returns how many were
 * sent. Never throws into the caller — the survey sweep must not fail on it.
 */
export async function sendTripCityInvites(event: {
  id: string
  cityId: string
  originCityId: string | null
  hostId: string
  attendeeIds: string[]
}): Promise<number> {
  if (!event.originCityId || event.originCityId === event.cityId) return 0
  try {
    const [city, cohosts] = await Promise.all([
      prisma.city.findUnique({ where: { id: event.cityId }, select: { name: true, slug: true, status: true } }),
      prisma.eventCoHost.findMany({ where: { eventId: event.id }, select: { userId: true } }),
    ])
    // A paused or closed city can't be joined — an invite would dead-end.
    if (!city || city.status !== 'live') return 0

    const travellers = [...event.attendeeIds, event.hostId, ...cohosts.map(c => c.userId)]
    const [homes, joined] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: travellers }, cityId: event.cityId }, select: { id: true } }),
      prisma.cityRelationship.findMany({ where: { userId: { in: travellers }, cityId: event.cityId, type: 'member' }, select: { userId: true } }),
    ])
    const already = new Set([...homes.map(u => u.id), ...joined.map(r => r.userId)])
    const { title, body } = tripCityInviteMessage(city.name)

    let sent = 0
    for (const userId of tripCityInvitees(travellers, already)) {
      if (!await claimOnce(`trip-city-invite:${event.id}:${userId}`, 30 * 24 * 60 * 60_000)) continue
      if (await createNotification(userId, 'city_launch', title, body, `/${city.slug}`)) sent++
    }
    return sent
  } catch (e) {
    console.error('[trip city invites]', event.id, e)
    return 0
  }
}
