// ─── Club template catalog ───────────────────────────────────────────────────
//
// The city-agnostic "starter lineup" every new city launches with. Each entry
// is a template, NOT a club: when a city is launched, `seedCityClubs` creates a
// real Club row per template (own members, hosts, wall, events) with a
// city-scoped slug (`<key>-<citySlug>`), since Club.slug is globally unique.
//
// `{city}` in `name`/`description` is replaced with the city's display name at
// seed time, so each city's clubs read locally ("Hiking around Lisbon") while
// the lineup and branding stay consistent everywhere.
//
// This is intentionally a curated subset — not every Istanbul club. A new city
// shouldn't open with 140 empty clubs; it should open with a tight, popular
// lineup that fills in as the community grows.

export interface ClubTemplate {
  /** Stable slug base, combined with the city slug → `<key>-<citySlug>`. */
  key: string
  name: string
  category: string
  emoji: string
  /** Tailwind text colour, e.g. 'text-blue-600' (matches existing clubs). */
  color: string
  /** Tailwind bg colour, e.g. 'bg-blue-50'. */
  bgColor: string
  description: string
}

export const CLUB_TEMPLATES: ClubTemplate[] = [
  // The flagship. Istanbul's equivalent (Social Istanbul) holds 1,446 members
  // — roughly every approved member, and four times the next biggest club — yet
  // it predates this catalogue, so cities seeded from templates were launching
  // without their single most important club. It leads the list because it's
  // the one every member joins and the natural home for a new city's first
  // gathering.
  {
    key: 'social', name: 'Social {city}', category: 'Social',
    emoji: '💬', color: 'text-amber-600', bgColor: 'bg-amber-50',
    description: 'The signature Smileys gathering in {city} — the easiest way to meet people, whether you arrived last week or grew up here.',
  },
  {
    key: 'language-exchange', name: 'Language Exchange', category: 'Language',
    emoji: '💬', color: 'text-purple-600', bgColor: 'bg-purple-50',
    description: 'Practice languages and make friends over relaxed conversation nights across {city}. All levels welcome.',
  },
  {
    key: 'foodies', name: 'Eat Up {city}', category: 'Food & Dining',
    emoji: '🍽️', color: 'text-orange-600', bgColor: 'bg-orange-50',
    description: "Discover {city}'s best restaurants, hidden kitchens, and street food with people who love eating out.",
  },
  {
    key: 'hiking', name: 'Hiking Club', category: 'Outdoors',
    emoji: '🥾', color: 'text-amber-600', bgColor: 'bg-amber-50',
    description: "Explore {city}'s trails, forests, and coastal paths — weekly hikes for every level.",
  },
  {
    key: 'flow', name: 'Flow', category: 'Wellness',
    emoji: '🧘', color: 'text-green-600', bgColor: 'bg-green-50',
    description: 'Outdoor yoga, breathwork, and mindful movement across {city}. Wellness for the social soul.',
  },
  {
    key: 'book-club', name: 'Book Club', category: 'Culture',
    emoji: '📚', color: 'text-rose-600', bgColor: 'bg-rose-50',
    description: 'Monthly reads and cozy discussions with fellow book lovers in {city}.',
  },
  {
    key: 'coffee-social', name: 'Coffee & Conversation', category: 'Social',
    emoji: '☕', color: 'text-amber-700', bgColor: 'bg-amber-50',
    description: 'Casual coffee meetups for newcomers and locals to connect across {city}.',
  },
  {
    key: 'shutterbugs', name: 'Shutterbugs', category: 'Creative',
    emoji: '📷', color: 'text-slate-600', bgColor: 'bg-slate-50',
    description: "Photo walks and shoots capturing {city}'s streets, light, and people.",
  },
  {
    key: 'football', name: 'Football Club', category: 'Sports',
    emoji: '⚽', color: 'text-green-700', bgColor: 'bg-green-50',
    description: 'Weekly pickup football and five-a-side games around {city}.',
  },
  {
    key: 'board-games', name: 'Board Game Night', category: 'Social',
    emoji: '🎲', color: 'text-indigo-600', bgColor: 'bg-indigo-50',
    description: 'Strategy, party games, and good company — game nights across {city}.',
  },
  {
    key: 'live-music', name: 'Live & Loud', category: 'Music',
    emoji: '🎸', color: 'text-red-600', bgColor: 'bg-red-50',
    description: "Gig buddies for {city}'s concerts, jazz nights, and open mics.",
  },
  {
    key: 'run-club', name: 'Run Club', category: 'Outdoors',
    emoji: '🏃', color: 'text-blue-600', bgColor: 'bg-blue-50',
    description: 'Group runs for all paces — explore {city} on foot, together.',
  },
  {
    key: 'newcomers', name: 'New in {city}', category: 'Newcomers',
    emoji: '👋', color: 'text-teal-600', bgColor: 'bg-teal-50',
    description: 'A warm landing for people who just moved to {city} — tips, friends, and first hangouts.',
  },
]
