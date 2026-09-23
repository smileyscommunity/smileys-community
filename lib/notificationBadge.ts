/**
 * What the bell's badge counts.
 *
 * It used to be every unread row the member held. That is a fine number while
 * it is small and a useless one once it is not: the admin account carries 977
 * unread — 619 of them application pings that nobody ever clears — so the
 * badge rendered its "9+" cap every day for months. A new application landed,
 * the badge did not move, and the bell had no way left to say "something
 * happened". Counting is not the same as signalling.
 *
 * So the badge counts what arrived since the member last OPENED the bell.
 * Reading a row still clears it too (isRead is in the filter), so dealing with
 * something on /notifications quiets the badge the same way looking at the
 * dropdown does.
 */

/** Rows that should light the badge: unread, and newer than the last look. */
export function newSinceWhere(userId: string, seenAt: Date | null) {
  return {
    userId,
    isRead: false,
    // Null is "never opened the bell", which counts all unread — exactly the
    // behaviour this replaces. That is deliberate and is why the migration
    // backfills nothing: every member keeps the badge they have today until
    // the first time they look, and nobody's unread pile is silently blanked.
    ...(seenAt ? { createdAt: { gt: seenAt } } : {}),
  }
}

/**
 * The number the bell renders, from a feed payload.
 *
 * Falls back to the unread count when `newCount` is absent rather than
 * showing nothing: a client left open across the deploy that adds the field
 * keeps the old badge instead of going dark and claiming all-clear. The same
 * reason the route's failure path returns 500 rather than an empty list.
 */
export function badgeCountFrom(feed: { unreadCount: number; newCount?: number | null }): number {
  return typeof feed.newCount === 'number' ? feed.newCount : feed.unreadCount
}

/**
 * The badge after a local change, so the bell does not wait out a poll.
 * Reading or dismissing rows can only take the count down, and opening the
 * bell takes it to zero — nothing a member does on this screen can raise it.
 */
export function badgeCountAfterRead(current: number, readCount: number): number {
  return Math.max(0, current - readCount)
}

/**
 * Whether a poll's `newCount` may be written to the badge.
 *
 * Opening the bell zeroes the badge locally and stamps the mark on the
 * server. A poll that was already in flight when that happened computed its
 * count against the OLD mark, so letting it land would put the badge straight
 * back up on a bell the member is looking at. Anything that started before
 * the last open is stale by definition — the poll after it carries the truth,
 * 60 seconds later at worst, and by then the badge should be 0 anyway.
 */
export function pollMaySetBadge(pollStartedAt: number, lastOpenedAt: number): boolean {
  return pollStartedAt >= lastOpenedAt
}
