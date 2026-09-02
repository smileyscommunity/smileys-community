// Board listing categories — label and emoji per Listing.category. The
// interactive board (components/BoardHub, a client component) carries its
// own richer table with badge and header colours; this is the server-safe
// subset the crawlable per-city board hub renders. Keep the two in step.
export const LISTING_CATEGORY: Record<string, { label: string; emoji: string }> = {
  ROOMS:       { label: 'Room',           emoji: '🏠' },
  JOBS:        { label: 'Job',            emoji: '💼' },
  SERVICES:    { label: 'Service',        emoji: '🛠️' },
  BUY_SELL:    { label: 'Buy / Sell',     emoji: '🛍️' },
  FREE:        { label: 'Free',           emoji: '🎁' },
  WANTED:      { label: 'Wanted',         emoji: '🔎' },
  RECO:        { label: 'Recommendation', emoji: '⭐' },
  LOST_FOUND:  { label: 'Lost & Found',   emoji: '🔍' },
  PETS:        { label: 'Adopt a Pet',    emoji: '🐾' },
  EXPERIENCES: { label: 'Experience',     emoji: '🎟️' },
}

export function listingCategory(code: string): { label: string; emoji: string } {
  return LISTING_CATEGORY[code] ?? { label: code, emoji: '📌' }
}
