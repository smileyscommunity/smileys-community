// ── Cross-city trips ─────────────────────────────────────────────────────────
//
// An Istanbul club's day out to Eskişehir is Eskişehir's event: it shows on
// that city's page and feed, uses its venue, clock and currency, and counts
// as the city's first event — which is the point, since the trip is how a
// city with no members gets one. It also departs from Istanbul, so it stays
// in Istanbul's feed (lib/db getEvents) with a trip badge.
//
//   cityId        — the city the trip VISITS (everything about the place)
//   originCityId  — the city it departs from (null on ordinary events)
//
// Who may run it follows the departure city: the trip belongs to an Istanbul
// club and is hosted by an Istanbul member, so the edit, host and moderator
// checks that used to read event.cityId read scopeCityId() instead. Reading
// the destination there would lock the organiser out of their own event.

import { CITY_STATUS } from './cityStatus'

/** The city whose staff and hosts are responsible for this event. */
export function scopeCityId(e: { cityId: string; originCityId?: string | null }): string {
  return e.originCityId ?? e.cityId
}

export interface TripRequest {
  /** Admins can set a trip on any city club; everyone else must host the club. */
  admin:        boolean
  isClubHost:   boolean
  /** The parent club's city — the departure city. Null for a global club. */
  clubCityId:   string | null
  clubCityTz:   string | null
  destination:  { id: string; status: string; timezone: string } | null
}

/**
 * Why this trip can't be filed, or null when it can. v1 rules:
 *   - a city club only (a global club has no departure city);
 *   - a real, live destination that isn't the club's own city;
 *   - the same timezone, because an event's date and time are stored as the
 *     destination's wall clock and the departure feed reads them as-is —
 *     every live city is Europe/Istanbul today, a future Tbilisi trip is not;
 *   - an admin, or a host of the club organising it.
 */
export function tripError(r: TripRequest): string | null {
  if (!r.admin && !r.isClubHost) return 'Only admins and the club\'s hosts can make an event a trip to another city'
  if (!r.clubCityId) return 'A trip departs from its club\'s city — a global club has none, so pick a city club'
  // Unknown and not-live answer the same, so the check can't be used to
  // learn whether a paused (non-public) city exists.
  if (!r.destination || r.destination.status !== CITY_STATUS.Live) return 'Trips can only go to a live Smileys city'
  if (r.destination.id === r.clubCityId) return 'A trip goes to another city — this is the club\'s own city'
  if (r.clubCityTz && r.destination.timezone !== r.clubCityTz) return 'Trips between cities in different timezones aren\'t supported yet'
  return null
}

/**
 * Both cities whose staff may moderate an event: the one it's filed in and,
 * for a trip, the one it departs from. Destination staff can edit or cancel
 * a trip on their own city's page; departure staff run the trip they own.
 * Publishing a trip stays the destination's call (see the events PUT).
 */
export function eventCityIds(e: { cityId: string; originCityId?: string | null }): string[] {
  return e.originCityId && e.originCityId !== e.cityId ? [e.cityId, e.originCityId] : [e.cityId]
}

/** "🚆 Istanbul → Eskişehir": one label for both cities' feeds. */
export function tripLabel(originName: string, destinationName: string): string {
  return `🚆 ${originName} → ${destinationName}`
}
