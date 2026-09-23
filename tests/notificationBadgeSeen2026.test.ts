import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { newSinceWhere, newMessagesWhere, badgeCountFrom, badgeCountAfterRead, pollMaySetBadge } from '@/lib/notificationBadge'
import { parseNotificationFeed, parseUnreadCount, meBadgeCount } from '@/lib/notificationFeed'

// 2026-09-23. An application arrived at 11:12 and the admin never saw it. The
// write path was fine — five staff rows, push attempted, quiet hours off. The
// bell was the problem: that account holds 977 unread, 619 of them application
// pings nobody ever clears, so the badge had rendered its "9+" cap for months.
// It was counting correctly and signalling nothing. The badge now counts what
// arrived since the member last opened the bell.

describe('what the badge counts', () => {
  it('counts only unread rows newer than the last look', () => {
    const seen = new Date('2026-09-23T10:00:00.000Z')
    expect(newSinceWhere('u1', seen)).toEqual({
      userId: 'u1',
      isRead: false,
      createdAt: { gt: seen },
    })
  })

  it('counts every unread row when the member has never opened the bell', () => {
    // Null is the whole reason the migration backfills nothing: until the
    // first look, every member keeps exactly the badge they have today.
    expect(newSinceWhere('u1', null)).toEqual({ userId: 'u1', isRead: false })
    expect('createdAt' in newSinceWhere('u1', null)).toBe(false)
  })

  it('still requires unread, so reading on /notifications quiets the badge too', () => {
    expect(newSinceWhere('u1', new Date()).isRead).toBe(false)
  })
})

describe('the number the bell renders', () => {
  it('prefers the new-since count over the lifetime unread pile', () => {
    expect(badgeCountFrom({ unreadCount: 977, newCount: 1 })).toBe(1)
  })

  it('shows nothing new when the member is caught up but never cleaned up', () => {
    expect(badgeCountFrom({ unreadCount: 977, newCount: 0 })).toBe(0)
  })

  it('falls back to unread rather than going dark on an older response', () => {
    // A PWA holding a tab open across the deploy that adds the field must not
    // read a missing count as all-clear — the same reason the route answers
    // 500 instead of an empty list.
    expect(badgeCountFrom({ unreadCount: 12 })).toBe(12)
    expect(badgeCountFrom({ unreadCount: 12, newCount: null })).toBe(12)
  })

  it('never goes negative as rows are read', () => {
    expect(badgeCountAfterRead(1, 3)).toBe(0)
    expect(badgeCountAfterRead(5, 2)).toBe(3)
  })
})

describe('a poll that started before the member opened the bell', () => {
  it('cannot put the badge back up on a bell being looked at', () => {
    const opened = 1_000
    expect(pollMaySetBadge(900, opened)).toBe(false)
  })

  it('lets a poll started after the open through', () => {
    expect(pollMaySetBadge(1_100, 1_000)).toBe(true)
    expect(pollMaySetBadge(1_000, 1_000)).toBe(true)
  })

  it('applies with no open at all, which is the common case', () => {
    expect(pollMaySetBadge(Date.now(), 0)).toBe(true)
  })
})

describe('the feed carries the count to the bell', () => {
  const row = { id: 'a', type: 'application', title: 'New application 📋', body: 'b', isRead: false, link: null, createdAt: '2026-09-23T11:12:22.286Z' }

  it('reads newCount alongside unreadCount', () => {
    const feed = parseNotificationFeed({ notifications: [row], unreadCount: 977, newCount: 1, hasMore: true })
    expect(feed?.unreadCount).toBe(977)
    expect(feed?.newCount).toBe(1)
    expect(badgeCountFrom(feed!)).toBe(1)
  })

  it('reports newCount as null — not zero — when the response predates it', () => {
    const feed = parseNotificationFeed({ notifications: [row], unreadCount: 977, hasMore: true })
    expect(feed?.newCount).toBeNull()
    expect(badgeCountFrom(feed!)).toBe(977)
  })

  it('reports null for the bare-array response an installed PWA may still hold', () => {
    expect(parseNotificationFeed([row])?.newCount).toBeNull()
  })

  it('ignores a nonsense count rather than trusting it', () => {
    const feed = parseNotificationFeed({ notifications: [row], unreadCount: 5, newCount: -3, hasMore: false })
    expect(feed?.newCount).toBeNull()
  })
})

describe('the phone Me badge agrees with the bell above it', () => {
  // The bell went new-since and this badge did not, so on one phone screen a
  // member with 2,999 unread would read "1" on the bell and "9+" here for the
  // same arrival — one signal contradicting itself.

  it('counts notifications since the last look, and DMs as they are', () => {
    // 2 unread DMs + 5 new since the look, 1 of which is a DM row = 2 + 4.
    expect(meBadgeCount({
      unreadMessages: 2, unreadNotifications: 999, messageNotifications: 3,
      newNotifications: 5, newMessages: 1,
    })).toBe(6)
  })

  it('goes quiet with the bell even on an account that never cleans up', () => {
    expect(meBadgeCount({
      unreadMessages: 0, unreadNotifications: 2999, messageNotifications: 0,
      newNotifications: 0, newMessages: 0,
    })).toBe(0)
  })

  it('keeps an unread DM even when nothing is new since the look', () => {
    // Glancing at a bell does not answer anybody.
    expect(meBadgeCount({
      unreadMessages: 4, unreadNotifications: 900, messageNotifications: 4,
      newNotifications: 0, newMessages: 0,
    })).toBe(4)
  })

  it('subtracts the new-since message rows, not the lifetime ones', () => {
    // The old field here would take 300 out of 5 and clamp to zero, losing
    // four genuinely new notifications on any busy account.
    expect(meBadgeCount({
      unreadMessages: 1, unreadNotifications: 900, messageNotifications: 300,
      newNotifications: 5, newMessages: 1,
    })).toBe(5)
  })

  it('falls back to the old exact sum when the route sends no new-since pair', () => {
    expect(meBadgeCount({ unreadMessages: 2, unreadNotifications: 7, messageNotifications: 2 })).toBe(7)
  })

  it('falls back again when only one half of the pair arrives', () => {
    expect(meBadgeCount({
      unreadMessages: 2, unreadNotifications: 7, messageNotifications: 2, newNotifications: 3,
    })).toBe(7)
  })

  it('still never counts one DM twice', () => {
    expect(meBadgeCount({
      unreadMessages: 1, unreadNotifications: 1, messageNotifications: 1,
      newNotifications: 1, newMessages: 1,
    })).toBe(1)
  })
})

describe('the count endpoint carries both pairs', () => {
  it('reads the new-since pair beside the lifetime one', () => {
    const c = parseUnreadCount({ unreadCount: 977, unreadMessages: 3, newCount: 2, newMessages: 1 })
    expect(c).toEqual({ unreadCount: 977, messageNotifications: 3, newCount: 2, newMessages: 1 })
  })

  it('reports the new-since pair as null on an older response', () => {
    const c = parseUnreadCount({ unreadCount: 977, unreadMessages: 3 })
    expect(c?.newCount).toBeNull()
    expect(c?.newMessages).toBeNull()
  })

  it('scopes the message subtraction to the same window as the count', () => {
    const seen = new Date('2026-09-23T12:00:00.000Z')
    expect(newMessagesWhere('u1', seen)).toEqual({
      userId: 'u1', isRead: false, createdAt: { gt: seen }, type: 'message',
    })
    expect(newMessagesWhere('u1', null)).toEqual({ userId: 'u1', isRead: false, type: 'message' })
  })
})

describe('the wiring the badge depends on', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('renders the badge from the new-since count, not from unread', () => {
    const src = read('components/NotificationBell.tsx')
    expect(src).toMatch(/\{badge > 0 && \(/)
    expect(src).toMatch(/\{badge > 9 \? '9\+' : badge\}/)
    // The lifetime count still backs the dropdown header and footer — those
    // say "unread" and mean it.
    expect(src).toMatch(/\(\{unread\} new\)/)
  })

  it('stamps the mark when the bell is opened, and only then', () => {
    const src = read('components/NotificationBell.tsx')
    expect(src).toMatch(/seen: true/)
    expect(src).toMatch(/openedAt\.current = Date\.now\(\)/)
    // A 60s poll in a background tab must not count as having looked.
    expect(src).not.toMatch(/seen: true[\s\S]{0,200}count=1/)
  })

  it('guards the badge against the poll that was already in flight', () => {
    expect(read('components/NotificationBell.tsx')).toMatch(/pollMaySetBadge\(startedAt, openedAt\.current\)/)
  })

  it('keeps the stamp out of the toast path', () => {
    // sendNotificationAction always toasts on failure. A red toast about a
    // request the member never made is worse than the stale badge it reports.
    const src = read('components/NotificationBell.tsx')
    expect(src).not.toMatch(/sendNotificationAction\('PATCH', \{ seen: true \}/)
  })

  it('ships the column as a migration, because the code selects it', () => {
    // Prisma selects every column in a model, so code ahead of its migration
    // throws P2022 on every User query — the whole surface, not the feature.
    const sql = read('prisma/migrations/20260923000002_notifications_seen_at/migration.sql')
    expect(sql).toMatch(/ALTER TABLE "users" ADD COLUMN "notificationsSeenAt"/)
    expect(read('prisma/schema.prisma')).toMatch(/notificationsSeenAt\s+DateTime\?/)
  })

  it('does not backfill the mark, which would blank every badge at once', () => {
    const sql = read('prisma/migrations/20260923000002_notifications_seen_at/migration.sql')
    expect(sql).not.toMatch(/UPDATE\s+"users"/i)
  })
})
