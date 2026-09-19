// Shapes and folding rules shared by the inbox and a thread.
//
// Both screens poll, and both used to trust whatever came back: the inbox
// wrote `Array.isArray(d) ? d : []`, so one failed tick replaced a full inbox
// with the "No messages yet" empty state, and the thread only ever appended,
// so a read receipt, a new reaction and a deleted message were all invisible
// until a reload. The functions here are the other half of that: a payload is
// either understood or ignored, and a refresh is merged rather than pushed.

export interface InboxPartner {
  id: string
  name: string
  color: string
  profilePhoto: string | null
  // A connections-only member the viewer isn't connected to. The server has
  // already cut the name back to a first name and dropped the photo; the flag
  // exists so the UI doesn't add anything back — no presence, no "last seen".
  restricted: boolean
}

export interface Conversation {
  partner: InboxPartner
  preview: { text: string; hasImage: boolean }
  unread: number
  lastAt: string
}

export interface Inbox {
  conversations: Conversation[]
  totalUnread: number
}

/**
 * Read an inbox payload, or answer null when it isn't one.
 *
 * Null means "this tick told us nothing" — the caller keeps what's on screen.
 * Only a real `conversations: []` empties the list.
 */
export function readInbox(payload: unknown): Inbox | null {
  if (!payload || typeof payload !== 'object') return null
  const d = payload as { conversations?: unknown; totalUnread?: unknown }
  if (!Array.isArray(d.conversations)) return null

  const conversations: Conversation[] = []
  for (const raw of d.conversations as unknown[]) {
    const row = (raw ?? {}) as {
      partner?: Partial<InboxPartner>
      preview?: { text?: unknown; hasImage?: unknown }
      unread?: unknown
      lastAt?: unknown
    }
    if (!row.partner?.id) continue
    conversations.push({
      partner: {
        id:           String(row.partner.id),
        name:         typeof row.partner.name === 'string' ? row.partner.name : '',
        color:        typeof row.partner.color === 'string' ? row.partner.color : '#9ca3af',
        profilePhoto: typeof row.partner.profilePhoto === 'string' ? row.partner.profilePhoto : null,
        restricted:   !!row.partner.restricted,
      },
      preview: {
        text:     typeof row.preview?.text === 'string' ? row.preview.text : '',
        hasImage: !!row.preview?.hasImage,
      },
      unread: typeof row.unread === 'number' && Number.isFinite(row.unread) ? row.unread : 0,
      lastAt: typeof row.lastAt === 'string' ? row.lastAt : new Date(0).toISOString(),
    })
  }

  return {
    conversations,
    // The server counts unread across every thread, not just the ones in this
    // page of conversations; sum only as a fallback.
    totalUnread: typeof d.totalUnread === 'number' && Number.isFinite(d.totalUnread)
      ? d.totalUnread
      : conversations.reduce((s, c) => s + c.unread, 0),
  }
}

export interface Mergeable { id: string; createdAt: string }

/**
 * Fold a server response into what's on screen: rows that changed are
 * updated, rows that are new are added, and nothing is ever appended twice —
 * a send and the poll that follows it used to race into two copies of the
 * same message.
 *
 * `full` marks a response that re-sent a whole window rather than just the
 * newer rows. Only then can absence mean deletion, and only inside that
 * window: history the member loaded by hand sits older than anything the
 * refresh returned, so its absence says nothing. `keep` protects rows this
 * client created after the refresh went out, which the server hadn't seen yet
 * when it answered.
 */
export function mergeMessages<T extends Mergeable>(
  current: readonly T[],
  incoming: readonly T[],
  opts: { full?: boolean; keep?: readonly string[] } = {},
): T[] {
  const byId = new Map(incoming.map(m => [m.id, m]))
  // Oldest instant the response actually covered. An empty full response
  // covers everything — the thread really is empty.
  const windowStart = opts.full
    ? incoming.reduce<string>((min, m) => (m.createdAt < min ? m.createdAt : min), incoming[0]?.createdAt ?? '')
    : null
  const keep = new Set(opts.keep ?? [])

  const merged: T[] = []
  for (const m of current) {
    const fresh = byId.get(m.id)
    if (fresh) {
      merged.push({ ...m, ...fresh })
      byId.delete(m.id)
      continue
    }
    if (windowStart !== null && m.createdAt >= windowStart && !keep.has(m.id)) continue
    merged.push(m)
  }
  for (const m of incoming) if (byId.has(m.id)) merged.push(m)

  // Sort is stable, so messages sharing a timestamp keep the order the server
  // sent them in.
  return merged.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

/**
 * What a reaction list looks like the instant the viewer taps an emoji —
 * the picker shouldn't sit there doing nothing until the round trip lands.
 * The server's answer replaces this, and a failure rolls it back.
 */
export function toggleReactionLocal<R extends { userId: string; emoji: string }>(
  reactions: readonly R[],
  userId: string | undefined,
  emoji: string,
): R[] {
  if (!userId) return [...reactions]
  const mine = reactions.some(r => r.userId === userId && r.emoji === emoji)
  return mine
    ? reactions.filter(r => !(r.userId === userId && r.emoji === emoji))
    : [...reactions, { userId, emoji } as R]
}
