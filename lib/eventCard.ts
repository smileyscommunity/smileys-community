import type { Event } from '@/lib/data'

// What an event CARD needs, and nothing else. EventTabs and EventCard are
// client components, so every field of the objects they receive is in the
// page's flight payload even though a card shows a dozen of them: the landing
// page shipped all 24 events whole, and a guest could read a members-only
// event's description (one carried the host's phone number, others the venue
// the location redaction had just withheld) and the gender and nationality
// admission quotas no public page shows. Built from an allowlist, so a new
// column on Event stays off the wire until a card needs it.
//
// Run it AFTER the viewer projection (redactEventForGuest /
// projectEventsForMember): it narrows, it never widens. The type stays Event
// so the card components take it unchanged; the fields it drops are blanked.
export type CardEvent = Event & { cityName?: string; timeZone?: string }

export function toEventCard<T extends CardEvent>(e: T): CardEvent {
  return {
    id: e.id, title: e.title, date: e.date, time: e.time, endTime: e.endTime ?? null,
    status: e.status, emoji: e.emoji, neighborhood: e.neighborhood,
    coverImage: e.coverImage, coverImagePosition: e.coverImagePosition,
    hostName: e.hostName, hostColor: e.hostColor, hostPhoto: e.hostPhoto ?? null, hostNationality: e.hostNationality ?? null,
    featured: e.featured, intent: e.intent, isPremium: e.isPremium, membersOnly: e.membersOnly,
    isFirstTimerFriendly: e.isFirstTimerFriendly, genderBalance: e.genderBalance, approvalRequired: e.approvalRequired,
    language: e.language ?? null, vibes: e.vibes,
    price: e.price, memberPrice: e.memberPrice, currency: e.currency,
    limitedSpots: e.limitedSpots, totalSpots: e.totalSpots, spotsLeft: e.spotsLeft,
    soldOut: e.soldOut, waitlistCount: e.waitlistCount,
    attendeePreviews: e.attendeePreviews ?? [],
    cityName: e.cityName, timeZone: e.timeZone,
    // Required by the Event type, never read by a card: blank, not the value.
    location: '', description: '', hostId: '', clubId: '', clubName: '', tags: [],
  }
}
