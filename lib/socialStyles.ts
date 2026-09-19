// The "social style" chips a member picks on /profile (and /apply). Shared
// so the member profile can show what was picked: the editor collected these
// for months while no page ever displayed them, which made the question a
// promise the product didn't keep.
export const SOCIAL_STYLES = [
  { id: 'deep_talker',       label: '🗣️ Deep Talker',       desc: 'Loves meaningful 1:1 conversations' },
  { id: 'social_butterfly',  label: '🎉 Social Butterfly',   desc: 'Energized by big groups' },
  { id: 'connector',         label: '🤝 Connector',          desc: 'Loves introducing people to each other' },
  { id: 'initiator',         label: '🔥 Initiator',          desc: 'Always the one to break the ice' },
  { id: 'laid_back',         label: '🧘 Laid-back',          desc: 'Goes with the flow, no agenda' },
  { id: 'new_in_town',       label: '🌱 New in Town',        desc: 'Fresh arrival still exploring' },
  { id: 'small_groups',      label: '☕ Small Groups',       desc: 'Prefers intimate settings' },
  { id: 'up_for_anything',   label: '🎭 Up for Anything',    desc: 'Spontaneous and adventurous' },
] as const

const LABELS = new Map<string, string>(SOCIAL_STYLES.map(s => [s.id, s.label]))

// Unknown ids render nothing rather than a raw snake_case key: an id retired
// from the list shouldn't surface as "old_style_name" on someone's profile.
export function socialStyleLabel(id: string): string | null {
  return LABELS.get(id) ?? null
}
