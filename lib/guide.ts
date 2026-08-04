// Istanbul Guide — experience content layer. The Guide answers "what
// should I experience?" (the Handbook answers "how do I function here",
// the Directory "where do I find a business"). Experiences are editorial
// JSON (data/guide-experiences.json) — repo-managed for now, so content
// ships with deploys; user interactions (saves/recommends) come later as
// DB rows keyed by slug.
// §4 of the plan — mood-based discovery beats category trees. Values are
// stable ids used in experience JSON + URL params; labels/emoji render
// the chips. Order = display order.
export const GUIDE_MOODS = [
  { value: 'eat',       label: 'Eat Something Great',          emoji: '🍽️' },
  { value: 'bosphorus', label: 'Be by the Bosphorus',          emoji: '🌊' },
  { value: 'iconic',    label: 'See Something Iconic',         emoji: '🏛️' },
  { value: 'night-out', label: 'Go Out Tonight',               emoji: '🍸' },
  { value: 'escape',    label: 'Escape the City',              emoji: '🌿' },
  { value: 'different', label: 'Discover Something Different', emoji: '🎨' },
  { value: 'free',      label: 'Do Something Free',            emoji: '💸' },
  { value: 'rainy',     label: "It's Raining",                 emoji: '☔' },
  { value: 'night',     label: 'Istanbul at Night',            emoji: '🌙' },
  { value: 'people',    label: 'Meet People',                  emoji: '👥' },
] as const
export type GuideMood = typeof GUIDE_MOODS[number]['value']

// §7 — collections group experiences into browsable shelves.
export const GUIDE_COLLECTIONS = [
  { value: 'bosphorus', label: 'Life on the Bosphorus', emoji: '🌊' },
  { value: 'eat',       label: 'Eat Istanbul',          emoji: '🍽️' },
  { value: 'night',     label: 'Istanbul After Dark',   emoji: '🌙' },
  { value: 'free',      label: 'Istanbul for Free',     emoji: '💸' },
  { value: 'escape',    label: 'Escape Istanbul',       emoji: '🌿' },
  { value: 'different', label: 'Beyond the Obvious',    emoji: '🎨' },
] as const
export type GuideCollection = typeof GUIDE_COLLECTIONS[number]['value']

export interface ExperienceSection {
  title: string
  items: string[]
}

export interface Experience {
  slug: string
  title: string
  emoji: string
  collection: GuideCollection
  moods: GuideMood[]
  // Card copy — one line that sells the experience (§8: don't clutter).
  tagline: string
  // Meta chips: cost ('Free' | 'Free-ish' | '₺' | '₺₺' | '₺₺₺'), rough
  // duration, and when to go. Freeform strings — they're display copy.
  cost: string
  time: string
  when: string
  // §9 template.
  why: string
  take: string          // §10 — The Smileys Take. Short, opinionated, honest.
  sections: ExperienceSection[]
  // §13 — neighborhoods to link ("Explore nearby"). Must be
  // NEIGHBORHOOD_META names or they're skipped at render.
  neighborhoods: string[]
  // §6 — surfaces on the "First time in Istanbul?" strip.
  firstTime?: boolean
}
