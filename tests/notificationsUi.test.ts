import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseNotificationFeed, parseUnreadCount, meBadgeCount, unreadCountAfterChange,
  previewUnreadFirst, mergeOlder, mergeRefresh, oldestCreatedAt, reconcileUnreadCount, clearAllConfirmLabel,
} from '@/lib/notificationFeed'
import { swipeAxis, SWIPE_AXIS_LOCK_PX } from '@/lib/swipeAxis'
import { timeAgo } from '@/lib/timeAgo'

// The notification surfaces (the page, the bell, the phone's Me badge) share
// one endpoint and used to each guess at what came back. These cover the
// guesses that were wrong: a failed request read as an empty inbox, a badge
// that counted every direct message twice, a bell that said "(3 new)" over six
// read rows, and a 30-row window mistaken for everything a member has.

const row = (id: string, over: Partial<{ isRead: boolean; type: string; createdAt: string; title: string }> = {}) => ({
  id, type: over.type ?? 'new_event', title: over.title ?? `Notification ${id}`, body: 'b',
  isRead: over.isRead ?? false, link: null, createdAt: over.createdAt ?? '2026-09-19T10:00:00.000Z',
})

describe('parseNotificationFeed', () => {
  it('reads the count from the whole account, not from the loaded slice', () => {
    const feed = parseNotificationFeed({
      notifications: [row('a', { isRead: true }), row('b')],
      unreadCount: 212,
      hasMore: true,
    })
    expect(feed?.notifications).toHaveLength(2)
    expect(feed?.unreadCount).toBe(212)
    expect(feed?.hasMore).toBe(true)
  })

  it('returns null for a body that is not a feed, so a failure is never an empty inbox', () => {
    // The old code did `Array.isArray(d) ? d : []` — every one of these read as
    // "you're all caught up", including the { error } an expired session gets.
    for (const junk of [null, undefined, 'nope', 42, { error: 'Unauthorized' }, { notifications: 'x' }]) {
      expect(parseNotificationFeed(junk)).toBeNull()
    }
  })

  it('still reads the old bare-array response an installed PWA may be holding', () => {
    const feed = parseNotificationFeed([row('a'), row('b', { isRead: true })])
    expect(feed?.notifications).toHaveLength(2)
    expect(feed?.unreadCount).toBe(1)
    expect(feed?.hasMore).toBe(false)
  })

  it('falls back to counting the slice when the route sends no count', () => {
    expect(parseNotificationFeed({ notifications: [row('a'), row('b')] })?.unreadCount).toBe(2)
  })
})

describe('the Me badge counts a message once', () => {
  it('adds the inbox count to everything that is not a message notification', () => {
    // 3 unread DMs, 5 unread notifications of which 3 are the DMs' own rows.
    expect(meBadgeCount({ unreadMessages: 3, unreadNotifications: 5, messageNotifications: 3 })).toBe(5)
    // The bug: 3 + 5 = 8 for five things.
    expect(meBadgeCount({ unreadMessages: 3, unreadNotifications: 5, messageNotifications: 3 })).not.toBe(8)
  })

  it('never double counts when the route sends no breakdown', () => {
    expect(meBadgeCount({ unreadMessages: 3, unreadNotifications: 3 })).toBe(3)
    expect(meBadgeCount({ unreadMessages: 3, unreadNotifications: 7 })).toBe(7)
    expect(meBadgeCount({ unreadMessages: 0, unreadNotifications: 0 })).toBe(0)
  })

  it('reads the count payload, and leaves the badge alone when it cannot', () => {
    // The payload carries a second pair now — the same two counts taken since
    // the member last opened the bell, which is what the badge prefers so it
    // agrees with the bell (tests/notificationBadgeSeen2026). Null here means
    // the response predates them, not that there is nothing new.
    expect(parseUnreadCount({ unreadCount: 12, unreadMessages: 4 }))
      .toEqual({ unreadCount: 12, messageNotifications: 4, newCount: null, newMessages: null })
    expect(parseUnreadCount({ unreadCount: 12, unreadMessages: 4, newCount: 2, newMessages: 1 }))
      .toEqual({ unreadCount: 12, messageNotifications: 4, newCount: 2, newMessages: 1 })
    expect(parseUnreadCount({ unreadCount: 12 }))
      .toEqual({ unreadCount: 12, messageNotifications: null, newCount: null, newMessages: null })
    for (const junk of [null, [], { error: 'Server error' }, { unreadCount: 'lots' }]) {
      expect(parseUnreadCount(junk)).toBeNull()
    }
  })

  it('clears on mark-all-read and on clear-all without waiting for a poll', () => {
    expect(unreadCountAfterChange(9, { kind: 'readAll' })).toBe(0)
    expect(unreadCountAfterChange(9, { kind: 'clearAll' })).toBe(0)
    expect(unreadCountAfterChange(9, { kind: 'read', ids: ['a', 'b'] })).toBe(7)
    expect(unreadCountAfterChange(1, { kind: 'read', ids: ['a', 'b'] })).toBe(0)
    // A dismissed row may already have been read — the refetch behind it settles it.
    expect(unreadCountAfterChange(9, { kind: 'dismiss', ids: ['a'] })).toBe(9)
  })
})

describe('the bell preview shows what its header claims', () => {
  it('leads with unread rows, newest first within each group', () => {
    const list = [
      row('r1', { isRead: true }), row('r2', { isRead: true }), row('r3', { isRead: true }),
      row('r4', { isRead: true }), row('r5', { isRead: true }), row('r6', { isRead: true }),
      row('u1'), row('u2'),
    ]
    const preview = previewUnreadFirst(list, 6)
    expect(preview.map(n => n.id)).toEqual(['u1', 'u2', 'r1', 'r2', 'r3', 'r4'])
    // Newest-first alone showed six read rows under "(2 new)".
    expect(preview.filter(n => !n.isRead)).toHaveLength(2)
  })

  it('fills with read rows when there is nothing unread', () => {
    const list = [row('a', { isRead: true }), row('b', { isRead: true })]
    expect(previewUnreadFirst(list, 6).map(n => n.id)).toEqual(['a', 'b'])
  })

  it('caps at the limit when everything is unread', () => {
    expect(previewUnreadFirst(Array.from({ length: 10 }, (_, i) => row(`u${i}`)), 6)).toHaveLength(6)
  })
})

describe('older pages', () => {
  it('appends without duplicating a row that arrived in between', () => {
    const merged = mergeOlder([row('a'), row('b')], [row('b'), row('c')])
    expect(merged.map(n => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('a refresh keeps the older pages the member pulled in', () => {
    const held  = [row('a'), row('b', { createdAt: '2026-09-18T10:00:00.000Z' }), row('old', { createdAt: '2026-08-01T10:00:00.000Z' })]
    const fresh = [row('new', { createdAt: '2026-09-20T10:00:00.000Z' }), row('a'), row('b', { createdAt: '2026-09-18T10:00:00.000Z' })]
    // Replacing outright would have snatched 'old' back every 60 seconds.
    expect(mergeRefresh(held, fresh).map(n => n.id)).toEqual(['new', 'a', 'b', 'old'])
  })

  it('an emptied account clears the tail too', () => {
    expect(mergeRefresh([row('old', { createdAt: '2026-08-01T10:00:00.000Z' })], [])).toEqual([])
  })

  it('takes the cursor from the oldest row held', () => {
    expect(oldestCreatedAt([row('a', { createdAt: 'x' }), row('b', { createdAt: 'y' })])).toBe('y')
    expect(oldestCreatedAt([])).toBeNull()
  })

  it('subtracts reads the landing poll had not seen yet', () => {
    const before = [row('a'), row('b', { isRead: true })]
    const after  = [row('a', { isRead: true }), row('b', { isRead: true })]
    // The server said 5 unread but its read predates the mark-read now settling.
    expect(reconcileUnreadCount(5, before, after)).toBe(4)
    expect(reconcileUnreadCount(5, before, before)).toBe(5)
    expect(reconcileUnreadCount(0, before, after)).toBe(0)
  })
})

describe('clear all names what it deletes', () => {
  it('counts the rows when the whole history is on screen', () => {
    expect(clearAllConfirmLabel({ loaded: 12, hasMore: false, unreadCount: 3 })).toContain('all 12 notifications')
    expect(clearAllConfirmLabel({ loaded: 1, hasMore: false, unreadCount: 0 })).toContain('all 1 notification?')
  })

  it('does not quote the loaded 30 as the total when older rows exist', () => {
    const label = clearAllConfirmLabel({ loaded: 30, hasMore: true, unreadCount: 7 })
    expect(label).not.toContain('30')
    expect(label).toContain("7 you haven't read")
    expect(clearAllConfirmLabel({ loaded: 30, hasMore: true, unreadCount: 0 })).toContain("ones you haven't read")
  })
})

describe('swipe axis', () => {
  it('ignores the sideways drift of a scrolling thumb', () => {
    // 6px across while scrolling down: the old `+4` rule called this a swipe.
    expect(6 > 0 + 4).toBe(true)          // what the old rule saw
    expect(swipeAxis(6, 2)).toBeNull()    // what it takes now
    expect(swipeAxis(10, 40)).toBe('v')
  })

  it('still commits to a deliberate swipe', () => {
    expect(swipeAxis(-40, 3)).toBe('h')
    expect(swipeAxis(SWIPE_AXIS_LOCK_PX + 1, 0)).toBe('h')
    expect(swipeAxis(SWIPE_AXIS_LOCK_PX, 0)).toBeNull()
  })

  it('stays undecided on a diagonal rather than guessing', () => {
    expect(swipeAxis(30, 30)).toBeNull()
  })
})

describe('timestamps follow the city clock', () => {
  afterEach(() => { vi.useRealTimers() })

  it('dates a notification by the city, not by the device', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-01T12:00:00.000Z'))
    // 22:30 UTC on 1 Jan is already 01:30 on 2 Jan in Istanbul.
    const iso = '2026-01-01T22:30:00.000Z'
    expect(timeAgo(iso, { timeZone: 'Europe/Istanbul' })).toBe('2 Jan')
    expect(timeAgo(iso, { timeZone: 'UTC' })).toBe('1 Jan')
  })

  it('adds the year in the city’s reckoning', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'))
    expect(timeAgo('2025-12-31T23:00:00.000Z', { timeZone: 'Europe/Istanbul' })).toBe('1 Jan')
    expect(timeAgo('2025-12-31T23:00:00.000Z', { timeZone: 'UTC' })).toBe('31 Dec 2025')
  })

  it('leaves the recent relative labels alone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-01T12:00:00.000Z'))
    expect(timeAgo('2026-02-01T11:59:30.000Z', { timeZone: 'UTC' })).toBe('just now')
    expect(timeAgo('2026-02-01T09:00:00.000Z', { timeZone: 'UTC' })).toBe('3h ago')
  })
})

// Source pins: these are behaviours of components, and the suite runs without a
// DOM. They'd each be a regression someone could reintroduce in one line.
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('the surfaces stay wired the way they claim', () => {
  it('the Me badge asks for a count, not thirty rows with message previews', () => {
    const nav = src('components/BottomNav.tsx')
    expect(nav).toContain("/app/api/notifications?count=1")
    expect(nav).toContain('meBadgeCount')
    // The double count that started this.
    expect(nav).not.toContain('unreadMessages + unreadNotifications')
  })

  it('the Me badge listens for mark-read and dismiss like the other two', () => {
    expect(src('components/BottomNav.tsx')).toContain('subscribeNotificationChanges')
  })

  it('the notifications page refreshes on the same 60s beat as the bell', () => {
    const page = src('app/(member)/notifications/page.tsx')
    expect(page).toContain('setInterval(load, 60_000)')
    expect(src('components/NotificationBell.tsx')).toContain('setInterval(load, 60_000)')
  })

  it('a linkless push opens the notifications list, not the dashboard', () => {
    const sw = src('public/sw.js')
    expect(sw).toContain("payload.link ?? '/app/notifications'")
    expect(sw).toContain("`/app${raw || '/notifications'}`")
    expect(sw).not.toContain("'/dashboard'")
  })

  it('the settings gear lands on the notifications section', () => {
    expect(src('app/(member)/notifications/settings/page.tsx')).toContain("redirect('/settings#notifications')")
    expect(src('app/(member)/settings/page.tsx')).toContain('<Section id="notifications"')
    expect(src('app/(member)/notifications/page.tsx')).toContain('href="/settings#notifications"')
  })

  it('the push card clears the bottom nav and the home indicator', () => {
    expect(src('components/PushPermission.tsx')).toContain('bottom-[calc(5rem+env(safe-area-inset-bottom))]')
  })
})
