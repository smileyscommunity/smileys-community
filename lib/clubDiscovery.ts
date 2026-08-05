// Client-safe Clubs discovery constants — no prisma imports, so the
// /clubs client page can use them directly. Server-side health logic
// lives in lib/clubHealth.ts (which re-uses these).

// Discovery filter groups (Clubs brief §8) — a display-level
// consolidation of the 16 stored categories into 9 browseable filters.
// Club.category in the DB is untouched; renames happen here only.
// 'Exclusive' is a badge, not a browse group.
export const CLUB_FILTER_GROUPS: { value: string; label: string; emoji: string; categories: string[] }[] = [
  { value: 'social',       label: 'Social',            emoji: '🎉', categories: ['Social', 'Nightlife'] },
  { value: 'outdoors',     label: 'Sports & Outdoors', emoji: '🏃', categories: ['Sports', 'Outdoor'] },
  { value: 'food',         label: 'Food & Drink',      emoji: '🍽️', categories: ['Food & Drinks'] },
  { value: 'languages',    label: 'Languages',         emoji: '🗣️', categories: ['Language'] },
  { value: 'arts',         label: 'Arts & Culture',    emoji: '🎨', categories: ['Creative', 'Culture'] },
  { value: 'professional', label: 'Professional',      emoji: '💼', categories: ['Networking', 'Business', 'Professional', 'Technology'] },
  { value: 'wellness',     label: 'Wellness',          emoji: '🧘', categories: ['Wellness'] },
  { value: 'travel',       label: 'Travel',            emoji: '✈️', categories: ['Travel'] },
  { value: 'volunteering', label: 'Volunteering',      emoji: '🤝', categories: ['Volunteering'] },
]

export type ClubHealthLabel = 'active' | 'new' | 'quiet' | 'archived'

// Discovery sort: Active first, New gets the benefit of the doubt,
// Quiet last. Archived never reaches the client.
export const HEALTH_RANK: Record<ClubHealthLabel, number> = { active: 0, new: 1, quiet: 2, archived: 3 }
