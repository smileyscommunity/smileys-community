// ── What the three notification surfaces agree on ──────────────────────────
//
// /notifications, the navbar bell and the phone's Me badge each read the same
// endpoint and each used to interpret it their own way: all three took a
// non-array as "nothing", so an expired session (or a 500) read as "You're all
// caught up", and all three believed a member owned exactly the 30 rows the
// route hands back. GET /api/notifications now answers
// `{ notifications, unreadCount, hasMore }` — the newest 30, the unread count
// across EVERY row, and whether older ones exist — and this module is the one
// place that shape is read and counted.
//
// Client-safe (no imports): every consumer is a client component.

export interface NotificationRow {
  id:        string
  type:      string
  title:     string
  body:      string
  isRead:    boolean
  link:      string | null
  createdAt: string
  /** A broadcast's image, on the announcement card only. Null everywhere else. */
  imageUrl:  string | null
}

export interface NotificationFeed {
  notifications: NotificationRow[]
  /** Unread across all of the member's rows, not just the loaded slice. */
  unreadCount: number
  /**
   * Unread AND newer than the last time the member opened the bell — what the
   * badge shows (lib/notificationBadge). Null from a response that predates
   * the field, which the badge reads as "fall back to unreadCount" rather
   * than as zero.
   */
  newCount: number | null
  /** There are rows older than the last one in `notifications`. */
  hasMore: boolean
}

function isRow(v: unknown): v is NotificationRow {
  return !!v && typeof v === 'object' && typeof (v as NotificationRow).id === 'string'
}

/**
 * The parsed feed, or null when the body isn't one — a null means "don't touch
 * what's on screen", never "the member has nothing".
 */
export function parseNotificationFeed(data: unknown): NotificationFeed | null {
  // A bare array is the pre-2026-09 response. An installed PWA can still be
  // holding one (its own cached build, or a tab open across the deploy), so
  // read it rather than blanking the list: the counts it can support are the
  // ones the slice itself carries.
  if (Array.isArray(data)) {
    const rows = data.filter(isRow)
    return { notifications: rows, unreadCount: rows.filter(n => !n.isRead).length, newCount: null, hasMore: rows.length >= 30 }
  }
  if (!data || typeof data !== 'object') return null
  const { notifications, unreadCount, newCount, hasMore } = data as Record<string, unknown>
  if (!Array.isArray(notifications)) return null
  const rows = notifications.filter(isRow)
  return {
    notifications: rows,
    unreadCount: typeof unreadCount === 'number' && unreadCount >= 0
      ? unreadCount
      : rows.filter(n => !n.isRead).length,
    newCount: typeof newCount === 'number' && newCount >= 0 ? newCount : null,
    hasMore: !!hasMore,
  }
}

/**
 * `?count=1` answers `{ unreadCount, unreadMessages }` — the second being the
 * unread `message` rows inside the first. Null when the body isn't that shape,
 * which means "leave the badge alone", never zero.
 */
export function parseUnreadCount(data: unknown): { unreadCount: number; messageNotifications: number | null } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { unreadCount, unreadMessages } = data as Record<string, unknown>
  if (typeof unreadCount !== 'number' || !(unreadCount >= 0)) return null
  return {
    unreadCount,
    // Older builds don't send it, and the badge is exact only when they do —
    // see meBadgeCount.
    messageNotifications: typeof unreadMessages === 'number' && unreadMessages >= 0 ? unreadMessages : null,
  }
}

/**
 * The Me badge counts a DM ONCE. Every direct message also writes a `message`
 * notification, so adding the inbox's unread count to the notification count
 * showed 2 for one message, 6 for three.
 *
 * With `messageNotifications` (the unread `message` rows the route breaks out)
 * the sum is exact: the inbox's own number plus everything else. Without it —
 * an older build answering the badge — the unread DMs are the best stand-in
 * for the message rows sitting inside `unreadNotifications`, and subtracting
 * them is the same as taking whichever number is larger; never the two added
 * together.
 */
export function meBadgeCount(
  { unreadMessages, unreadNotifications, messageNotifications = null }:
  { unreadMessages: number; unreadNotifications: number; messageNotifications?: number | null },
): number {
  if (messageNotifications !== null) {
    return unreadMessages + Math.max(0, unreadNotifications - messageNotifications)
  }
  return Math.max(unreadMessages, unreadNotifications)
}

/**
 * The server's unread count, corrected for what a landing poll doesn't know
 * yet. createNotificationSync overlays in-flight mark-reads and dismisses onto
 * the rows a poll brings back; `unreadCount` came from the same pre-action
 * read, so without this the list shows a row as read while the badge above it
 * still counts it. `before`/`after` are the loaded slice either side of that
 * overlay — the difference is unread rows the server hasn't caught up on.
 */
export function reconcileUnreadCount(
  serverCount: number,
  before: { isRead: boolean }[],
  after: { isRead: boolean }[],
): number {
  const settled = before.filter(n => !n.isRead).length - after.filter(n => !n.isRead).length
  return Math.max(0, serverCount - Math.max(0, settled))
}

// A change another surface (or another tab) already made on the server, applied
// to a bare count — the Me badge holds no list to run applyNotificationChange
// over, and it should clear the moment "mark all read" lands, not 60s later.
// 'dismiss' can't be resolved from a count alone (the row may have been read
// already), so it stands still and the refetch behind it settles the number.
export function unreadCountAfterChange(
  count: number,
  change: { kind: 'read' | 'dismiss'; ids: string[] } | { kind: 'readAll' | 'clearAll' },
): number {
  switch (change.kind) {
    case 'readAll':
    case 'clearAll': return 0
    case 'read':     return Math.max(0, count - change.ids.length)
    case 'dismiss':  return count
  }
}

/**
 * The bell shows six rows and a "(N new)" header. Newest-first meant a member
 * with six read rows on top was told about three new ones and shown none of
 * them, so unread rows lead — each group still newest-first.
 */
export function previewUnreadFirst<T extends { isRead: boolean }>(list: T[], limit: number): T[] {
  const unread = list.filter(n => !n.isRead)
  if (unread.length >= limit) return unread.slice(0, limit)
  return [...unread, ...list.filter(n => n.isRead)].slice(0, limit)
}

/** Append a "Load older" page, dropping anything already on screen. */
export function mergeOlder<T extends { id: string }>(list: T[], older: T[]): T[] {
  const seen = new Set(list.map(n => n.id))
  return [...list, ...older.filter(n => !seen.has(n.id))]
}

/**
 * What a refresh should leave on screen. A poll brings back the newest page
 * only; a member who pressed "Load older" holds more than that, and replacing
 * the list would snatch those pages back from under them every 60 seconds.
 * Everything older than the refreshed page's last row is kept.
 *
 * `createdAt` is compared as text, which is exact for the ISO-8601 UTC strings
 * the route serialises (same length, same offset, so byte order is time order).
 * An empty refresh means the account really is empty, tail included.
 */
export function mergeRefresh<T extends { id: string; createdAt: string }>(prev: T[], fresh: T[]): T[] {
  if (!fresh.length) return fresh
  const oldest = fresh[fresh.length - 1].createdAt
  return mergeOlder(fresh, prev.filter(n => n.createdAt < oldest))
}

/** The cursor for `?before=` — the oldest row we hold. */
export function oldestCreatedAt(list: { createdAt: string }[]): string | null {
  return list.length ? list[list.length - 1].createdAt : null
}

/**
 * Its tiebreaker. Two rows can share a millisecond — a fan-out, or a bundle
 * being restamped — and "older than this instant" alone can never reach the
 * one that shares it with the cursor.
 */
export function oldestCursor(list: { id: string; createdAt: string }[]): { before: string; beforeId: string } | null {
  const last = list[list.length - 1]
  return last ? { before: last.createdAt, beforeId: last.id } : null
}

/**
 * "Clear all" is a hard delete of every row, not of the 30 on screen, and the
 * confirm used to say nothing at all. Name the real number when we hold the
 * whole list; when older rows exist we can't count them, so say so plainly
 * rather than quoting the 30 we happen to have loaded.
 */
export function clearAllConfirmLabel(
  { loaded, hasMore, unreadCount }: { loaded: number; hasMore: boolean; unreadCount: number },
): string {
  if (!hasMore) {
    return `Delete all ${loaded} notification${loaded === 1 ? '' : 's'}? This can't be undone.`
  }
  return unreadCount > 0
    ? `Delete all notifications, including ${unreadCount} you haven't read? This can't be undone.`
    : "Delete all notifications, including ones you haven't read? This can't be undone."
}
