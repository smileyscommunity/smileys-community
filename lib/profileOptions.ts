// Single source of truth for the member-profile chip vocabularies.
//
// These lists were copy-pasted between /apply, /profile, and (now) the
// registration step, and had already drifted (two different COMMON_LANGUAGES
// orderings). More importantly, INTERESTS is the ONE vocabulary that
// personalization understands: the values match interest_tag_map.interest
// in the DB, which is what maps a member's interests to event tags
// (lib/firstEvent.ts). Free-text interests ("Travel", "Coffee") match zero
// tags and personalize nothing — which is why the registration form asks
// with these chips and nothing else.

export const INTERESTS = [
  { value: 'sailing',    label: 'Sailing',               emoji: '⛵' },
  { value: 'dining',     label: 'Dining',                emoji: '🍽️' },
  { value: 'social',     label: 'Social / Parties',      emoji: '🎉' },
  { value: 'wellness',   label: 'Wellness',              emoji: '🧘' },
  { value: 'networking', label: 'Networking / Business',  emoji: '🧠' },
  { value: 'languages',  label: 'Language Exchange',     emoji: '🌍' },
  { value: 'games',      label: 'Games / Trivia',        emoji: '🎲' },
  { value: 'outdoor',    label: 'Outdoor Activities',    emoji: '🚶' },
  // Added 2026-08-22: the interests backfill showed ~300 members whose
  // free-text answers clustered creative (Film, Art, Photography, Theatre,
  // Writing, Reading, Music…) with no canonical home. Maps to the
  // Creative/Cultural/Film/Music/Books event tags.
  { value: 'creative',   label: 'Arts & Creative',       emoji: '🎨' },
  // Added 2026-08-26: 'Travel' was the largest homeless free-text term
  // (191 members) and the platform already had Travel-category clubs
  // (City Breaks, Weekend Getaways, Solo Travel, Road Trips) and the
  // Adventure event tag with nothing pointing at them.
  { value: 'travel',     label: 'Travel & Trips',        emoji: '✈️' },
] as const

export const INTEREST_VALUES = new Set<string>(INTERESTS.map(i => i.value))

// Union of the two lists that had drifted apart (apply's + profile's),
// apply's ordering first — it's the funnel's list.
export const COMMON_LANGUAGES = [
  'English', 'Turkish', 'Arabic', 'Russian', 'German', 'French',
  'Spanish', 'Italian', 'Persian', 'Portuguese', 'Chinese', 'Japanese',
  'Korean', 'Hindi', 'Ukrainian', 'Dutch', 'Greek', 'Hebrew',
  'Swedish', 'Polish',
]

export const LOOKING_FOR_OPTIONS = [
  { id: 'friendship',        label: 'Friendship'         },
  { id: 'networking',        label: 'Networking'          },
  { id: 'language_exchange', label: 'Language exchange'   },
  { id: 'collaboration',     label: 'Collaboration'       },
  { id: 'mentorship',        label: 'Mentorship'          },
  { id: 'activities',        label: 'Activity partners'   },
] as const

export const LOOKING_FOR_VALUES = new Set<string>(LOOKING_FOR_OPTIONS.map(o => o.id))
