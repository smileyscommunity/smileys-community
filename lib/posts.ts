export const REACTION_EMOJIS = ['❤️', '👍', '🔥', '😂']

export function buildReactions(
  likes: { userId: string; emoji: string }[],
  sessionId?: string,
): { reactions: { emoji: string; count: number; reactedByMe: boolean }[]; myReaction: string | null } {
  const counts: Record<string, number> = {}
  let myReaction: string | null = null
  for (const l of likes) {
    counts[l.emoji] = (counts[l.emoji] ?? 0) + 1
    if (l.userId === sessionId) myReaction = l.emoji
  }
  return {
    reactions: REACTION_EMOJIS
      .map(e => ({ emoji: e, count: counts[e] ?? 0, reactedByMe: myReaction === e }))
      .filter(r => r.count > 0),
    myReaction,
  }
}

export function buildAuthor(u: {
  id: string; name: string; color: string; profilePhoto: string | null; role: string
}) {
  return { id: u.id, name: u.name, color: u.color, photo: u.profilePhoto, role: u.role }
}
