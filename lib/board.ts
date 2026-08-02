// Istanbul Board — shared constants for the conversation layer.
// Single source of truth for post types and chips: the API validates
// against these sets and the UI renders from them, so they can't drift.

export const BOARD_POST_TYPES = [
  { value: 'plan',     label: 'Plan',           emoji: '☕', action: "👋 I'm interested", badgeCls: 'bg-amber-100 text-amber-700'   },
  { value: 'question', label: 'Question',       emoji: '❓', action: '💬 Reply',          badgeCls: 'bg-blue-100 text-blue-700'     },
  { value: 'reco',     label: 'Recommendation', emoji: '💡', action: '❤️ Save',           badgeCls: 'bg-green-100 text-green-700'   },
  { value: 'share',    label: 'Community',      emoji: '📣', action: '💬 Reply',          badgeCls: 'bg-purple-100 text-purple-700' },
] as const
export type BoardPostType = typeof BOARD_POST_TYPES[number]['value']

// Plan activities double as the tag chip on plan posts.
export const PLAN_TAGS = [
  { value: 'coffee',   label: 'Coffee',   emoji: '☕' },
  { value: 'drinks',   label: 'Drinks',   emoji: '🍸' },
  { value: 'dinner',   label: 'Dinner',   emoji: '🍽️' },
  { value: 'walk',     label: 'Walk',     emoji: '🚶' },
  { value: 'music',    label: 'Music',    emoji: '🎶' },
  { value: 'activity', label: 'Activity', emoji: '🏃' },
  { value: 'hangout',  label: 'Hangout',  emoji: '🎉' },
] as const

export const QUESTION_TAGS = [
  { value: 'local_advice',   label: 'Local advice',   emoji: '💡' },
  { value: 'services',       label: 'Services',       emoji: '🛠️' },
  { value: 'moving',         label: 'Moving',         emoji: '📦' },
  { value: 'transport',      label: 'Transport',      emoji: '🚇' },
  { value: 'food',           label: 'Food',           emoji: '🍽️' },
  { value: 'activities',     label: 'Activities',     emoji: '🎯' },
] as const

export const PLAN_WHEN = ['Today', 'Tonight', 'Tomorrow'] as const

export const TAG_LABEL: Record<string, { label: string; emoji: string }> = Object.fromEntries(
  [...PLAN_TAGS, ...QUESTION_TAGS].map(t => [t.value, { label: t.label, emoji: t.emoji }]),
)
