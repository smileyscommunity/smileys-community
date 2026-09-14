// Neighborhood pickers on a COMPOSER must list the city the write will land
// in, not the city on screen. Hangout, pulse and listing POSTs validate the
// name against resolvePostingCityId (the member's own city unless they've
// joined the one they're browsing), and safeNeighborhoodFor returns null on a
// mismatch — so an Istanbul member browsing İzmir who picked "Alsancak" got a
// hangout filed to Istanbul with no neighborhood, no neighborhood fan-out, and
// a pulse whose audience quietly fell back to connections.

interface CityLike {
  slug: string
  posting?: { slug: string }
}

// The slug to hand useCityNeighborhoods for a composer. null while
// /api/city/current hasn't answered: the hook fetches nothing for null, where
// undefined would fetch the BROWSED city's list and flash it before switching.
// A resolved city without `posting` (only guests, who can't post) falls back
// to the viewed city rather than an empty picker.
export function postingNeighborhoodsCity(city: CityLike | null): string | null {
  if (!city) return null
  return city.posting?.slug || city.slug
}

// A prefilled neighborhood (a deep link from another city's neighborhood page,
// the moving-sale bridge) is only selected — and only sent — when the posting
// city actually has it. Otherwise the select would show one thing while the
// server silently saved another.
export function neighborhoodIfListed(name: string | null | undefined, list: readonly string[]): string {
  return name && list.includes(name) ? name : ''
}
