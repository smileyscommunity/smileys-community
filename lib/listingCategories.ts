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

// The marketplace categories a member can post in — the one list the member
// create route, the admin "Active Categories" setting and its save route all
// read. They were three hand-kept lists that had drifted apart: the setting
// offered Recommendations, Lost & Found and Experiences (which members can't
// post) and missed Wanted and Adopt a Pet (which they can), so the saved
// list could never describe what was actually open.

export const MEMBER_LISTING_CATEGORIES = [
  { id: 'ROOMS',    label: 'Rooms & Housing' },
  { id: 'JOBS',     label: 'Jobs & Gigs' },
  { id: 'SERVICES', label: 'Services' },
  { id: 'BUY_SELL', label: 'Buy & Sell' },
  { id: 'FREE',     label: 'Free Stuff' },
  { id: 'WANTED',   label: 'Wanted' },
  { id: 'PETS',     label: 'Adopt a Pet' },
] as const

export const MEMBER_LISTING_CATEGORY_IDS: string[] = MEMBER_LISTING_CATEGORIES.map(c => c.id)

// Marketplace settings as data/settings.json stores them (/admin/listings).
export interface ListingSettings {
  enabledCategories?:  string[]
  defaultExpiryDays?:  number
  maxActivePerMember?: number
}

export const LISTING_SETTING_DEFAULTS = { defaultExpiryDays: 30, maxActivePerMember: 5 } as const
