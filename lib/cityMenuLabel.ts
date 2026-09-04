import { CITY_STATUS } from './cityStatus'
import { CITY_MATURITY, type CityMaturity } from './cityMaturity'

// What the Cities menu says next to a city.
//
// Status is a lifecycle word — can people see the page, can they join — and
// "live" is the honest status of a city with zero members and no event yet.
// It is not an honest badge. Ankara and Bursa launched with nobody in them,
// and a menu that put LIVE beside both, in the same green as Istanbul, was
// telling a visitor something that wasn't true.
//
// Maturity is the second dimension (lib/cityMaturity), derived from counts
// and impossible to flatter. This joins the two into the one word the menu
// needs, so the rule lives here and is tested here rather than in JSX.
export type CityMenuLabel = 'live' | 'founding' | 'coming_soon'

export function cityMenuLabel(status: string, maturity?: CityMaturity | null): CityMenuLabel {
  if (status !== CITY_STATUS.Live) return 'coming_soon'
  // A live city that is still seeding is founding, not live — the word the
  // city's own hero uses. Unknown maturity (a stale client, a failed stats
  // query) falls back to the status word rather than to the flattering one.
  if (maturity === CITY_MATURITY.Seeding) return 'founding'
  return 'live'
}
