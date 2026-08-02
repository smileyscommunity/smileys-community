// Istanbul Board — shared constants for the conversation layer.
// Single source of truth for post types and chips: the API validates
// against these sets and the UI renders from them, so they can't drift.

// 'plan' is deliberately NOT a board post type. "Anyone around for coffee?"
// already has a full system of record — Hangouts (location, times, joins,
// group chat) — and a third overlapping surface (after availability pulses)
// would fragment the same low-volume intent three ways. The Board composer
// routes "Make a Plan" to /hangouts, and the feed surfaces active hangouts
// as plan cards instead.
export const BOARD_POST_TYPES = [
  { value: 'question', label: 'Question',       emoji: '❓', action: '💬 Reply',          badgeCls: 'bg-blue-100 text-blue-700'     },
  { value: 'reco',     label: 'Recommendation', emoji: '💡', action: '❤️ Save',           badgeCls: 'bg-green-100 text-green-700'   },
  { value: 'share',    label: 'Community',      emoji: '📣', action: '💬 Reply',          badgeCls: 'bg-purple-100 text-purple-700' },
] as const
export type BoardPostType = typeof BOARD_POST_TYPES[number]['value']

export const QUESTION_TAGS = [
  { value: 'local_advice',   label: 'Local advice',   emoji: '💡' },
  { value: 'services',       label: 'Services',       emoji: '🛠️' },
  { value: 'moving',         label: 'Moving',         emoji: '📦' },
  { value: 'transport',      label: 'Transport',      emoji: '🚇' },
  { value: 'food',           label: 'Food',           emoji: '🍽️' },
  { value: 'activities',     label: 'Activities',     emoji: '🎯' },
] as const

export const TAG_LABEL: Record<string, { label: string; emoji: string }> = Object.fromEntries(
  QUESTION_TAGS.map(t => [t.value, { label: t.label, emoji: t.emoji }]),
)
