// Hangout activity taxonomy (plan §7). Single source: the API validates
// against these values, the composer renders chips from them, and cards
// look up the emoji here.
export const HANGOUT_ACTIVITIES = [
  { value: 'coffee',   label: 'Coffee',   emoji: '☕' },
  { value: 'drinks',   label: 'Drinks',   emoji: '🍸' },
  { value: 'food',     label: 'Food',     emoji: '🍽️' },
  { value: 'walk',     label: 'Walk',     emoji: '🚶' },
  { value: 'cowork',   label: 'Cowork',   emoji: '💻' },
  { value: 'exercise', label: 'Exercise', emoji: '🏃' },
  { value: 'outdoors', label: 'Outdoors', emoji: '🌳' },
  { value: 'music',    label: 'Music',    emoji: '🎶' },
  { value: 'games',    label: 'Games',    emoji: '🎲' },
  { value: 'other',    label: 'Something else', emoji: '✨' },
] as const

export const ACTIVITY_META: Record<string, { label: string; emoji: string }> = Object.fromEntries(
  HANGOUT_ACTIVITIES.map(a => [a.value, { label: a.label, emoji: a.emoji }]),
)

// Plan §7: normal hangouts cap at 10 — anything bigger is an Event.
export const HANGOUT_CAPACITIES = [2, 4, 6, 8, 10] as const
