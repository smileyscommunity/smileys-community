import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import {
  createNotificationSync, overlayPending, restoreAt, setReadFor,
} from '@/lib/notificationActions'
import { createPendingSessionGate, shouldRefreshPending } from '@/lib/pendingConnections'

// Scan 6, batch 22 — three low-severity races in member pages:
//   a — a notification poll answering mid mark-read / dismiss replaced the
//       list with the server's pre-action copy (row back, badge wrong, and a
//       second ✕ then failed with "Could not dismiss").
//   b — the pending-connections request of a signed-out account wrote its
//       count after sign-out and blocked the next account's own fetch.
//   c — deleting the deep-linked board post after its real page had also
//       arrived left the next-page offset one too far ("Load more" skipped one).

const read = (f: string) => readFileSync(f, 'utf8')

type N = { id: string; isRead: boolean }
const server = (): N[] => [{ id: 'a', isRead: false }, { id: 'b', isRead: false }, { id: 'c', isRead: true }]

describe('a — overlayPending', () => {
  it('re-applies pending reads and dismissals onto a fresh poll result', () => {
    const out = overlayPending(server(), [{ kind: 'read', ids: new Set(['a']) }, { kind: 'dismiss', id: 'b' }])
    expect(out).toEqual([{ id: 'a', isRead: true }, { id: 'c', isRead: true }])
  })
  it('a hold overlays nothing, and no actions leaves the list as served', () => {
    const list = server()
    expect(overlayPending(list, [{ kind: 'hold' }])).toBe(list)
    expect(overlayPending(list, [])).toBe(list)
  })
})

describe('a — createNotificationSync', () => {
  it('a poll with no action in between renders as served', () => {
    const sync = createNotificationSync()
    const list = server()
    expect(sync.resolvePoll(sync.startPoll(), list)).toBe(list)
  })

  it('drops a poll started before an action began', () => {
    const sync = createNotificationSync()
    const poll = sync.startPoll()
    sync.begin({ kind: 'dismiss', id: 'a' })
    expect(sync.resolvePoll(poll, server())).toBeNull()
  })

  it('overlays a poll started while the action is out', () => {
    const sync = createNotificationSync()
    const settle = sync.begin({ kind: 'dismiss', id: 'a' })
    const poll = sync.startPoll()
    expect(sync.resolvePoll(poll, server())!.map(n => n.id)).toEqual(['b', 'c'])
    settle()
  })

  it('drops a poll that went out mid-request and answers after it settled', () => {
    const sync = createNotificationSync()
    const settle = sync.begin({ kind: 'read', ids: new Set(['a']) })
    const poll = sync.startPoll()
    settle()
    expect(sync.resolvePoll(poll, server())).toBeNull()
  })

  it('stops overlaying once settled; settling twice does not invalidate later polls', () => {
    const sync = createNotificationSync()
    const settle = sync.begin({ kind: 'dismiss', id: 'a' })
    settle()
    const poll = sync.startPoll()
    settle()
    const list = server()
    expect(sync.resolvePoll(poll, list)).toBe(list)
  })

  it('keeps overlaying an action still out when another one settles', () => {
    const sync = createNotificationSync()
    const settleA = sync.begin({ kind: 'dismiss', id: 'a' })
    const settleB = sync.begin({ kind: 'read', ids: new Set(['b']) })
    settleA()
    const poll = sync.startPoll()
    expect(sync.resolvePoll(poll, server())).toEqual([
      { id: 'a', isRead: false }, { id: 'b', isRead: true }, { id: 'c', isRead: true },
    ])
    settleB()
  })

  it('the reported race: poll mid-dismiss keeps the row gone, a refusal still restores it once', () => {
    const sync = createNotificationSync()
    let shown = server()
    const removed = shown[0]
    const settle = sync.begin({ kind: 'dismiss', id: 'a' })
    shown = shown.filter(n => n.id !== 'a')
    // 60s poll lands before the DELETE answers
    const poll = sync.startPoll()
    const polled = sync.resolvePoll(poll, server())
    if (polled) shown = polled
    expect(shown.map(n => n.id)).toEqual(['b', 'c'])
    // DELETE refused → settle, then roll back
    settle()
    shown = restoreAt(shown, removed, 0)
    expect(shown.map(n => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('the reported race for mark-all: the badge stays at zero through a poll', () => {
    const sync = createNotificationSync()
    let shown = server()
    const ids = new Set(shown.filter(n => !n.isRead).map(n => n.id))
    sync.begin({ kind: 'read', ids })
    shown = setReadFor(shown, ids, true)
    const polled = sync.resolvePoll(sync.startPoll(), server())
    if (polled) shown = polled
    expect(shown.filter(n => !n.isRead)).toHaveLength(0)
  })
})

describe('a — bell and notifications page wiring', () => {
  it.each([
    ['components/NotificationBell.tsx', 'setNotifs'],
    ['app/(member)/notifications/page.tsx', 'setNotifications'],
  ])('%s routes polls and actions through the sync', (file, setter) => {
    const src = read(file)
    expect(src).toMatch(/const \[sync\] = useState\(createNotificationSync\)/)
    // the poll snapshots before fetching and only renders what resolvePoll allows
    const start = src.indexOf('const poll = sync.startPoll()')
    expect(start).toBeGreaterThan(-1)
    expect(start).toBeLessThan(src.indexOf("fetch('/app/api/notifications', { credentials: 'include' })"))
    // The body is parsed before it reaches the sync (lib/notificationFeed), so
    // a refused or unreadable response stops there instead of resolving into
    // an empty list the way `Array.isArray(d) ? d : []` did.
    expect(src).toMatch(/const feed = parseNotificationFeed\(/)
    expect(src).toMatch(/if \(!feed\) \{? ?(?:return|setLoadError)/)
    expect(src).toMatch(/const next = sync\.resolvePoll\(poll, feed\.notifications\)/)
    // The page folds the poll into any "Load older" pages already on screen;
    // the bell only ever holds the newest.
    expect(src).toMatch(new RegExp(`${setter}\\((?:next|prev => mergeRefresh\\(prev, next\\))\\)`))
    expect(src).not.toMatch(new RegExp(`${setter}\\(Array\\.isArray\\(d\\)`))
    // each action registers before its optimistic change and settles before
    // rollback (the unread count rides along with the list)
    expect(src).toMatch(new RegExp(`const settle = sync\\.begin\\(\\{ kind: 'read', ids \\}\\)\\s*${setter}\\(prev => setReadFor\\(prev, ids, true\\)\\)\\s*setUnread\\([^)]*\\)\\s*if \\(!await sendNotificationAction\\('PATCH', \\{ markAll: true \\}[^)]*\\)\\.finally\\(settle\\)\\)`))
    expect(src).toMatch(new RegExp(`const settle = sync\\.begin\\(\\{ kind: 'dismiss', id \\}\\)\\s*${setter}\\(prev => prev\\.filter\\(n => n\\.id !== id\\)\\)`))
    expect(src).toMatch(/const settle = sync\.begin\(\{ kind: 'read', ids \}\)[\s\S]{0,400}?sendNotificationAction\('PATCH', \{ id: n\.id \}[^)]*\)\.finally\(settle\)\.then\(ok =>/)
  })

  it('the dismiss request settles the sync on whichever surface sends it', () => {
    // The bell sends the DELETE on the click.
    expect(read('components/NotificationBell.tsx'))
      .toMatch(/if \(!await sendNotificationAction\('DELETE', \{ id \}[^)]*\)\.finally\(settle\)\)/)
    // The page holds it behind an Undo window, so the settle travels with the
    // pending entry — the overlay has to outlive the whole window, or a poll
    // in the meantime puts the row back under the member's finger.
    expect(read('app/(member)/notifications/page.tsx'))
      .toMatch(/sendNotificationAction\('DELETE', \{ id \}[^)]*\)\.finally\(entry\.settle\)/)
  })

  it('clear-all invalidates a refetch already out', () => {
    const src = read('app/(member)/notifications/page.tsx')
    expect(src).toMatch(/const settle = sync\.begin\(\{ kind: 'hold' \}\)\s*try \{\s*const res = await fetch\('\/app\/api\/notifications\?clearAll=true', \{[^}]*\}\)\.finally\(settle\)/)
  })
})

describe('b — pending-connections session gate', () => {
  it('a new session is not blocked by the previous one\'s in-flight request', () => {
    const gate = createPendingSessionGate()
    const old = gate.start()
    expect(gate.inFlight()).toBe(true)
    gate.bump()  // sign-out
    expect(gate.inFlight()).toBe(false)
    expect(gate.isCurrent(old)).toBe(false)
    expect(shouldRefreshPending({ reason: 'mount', now: 1, lastFetchAt: null, inFlight: gate.inFlight(), hidden: false })).toBe(true)
  })

  it('the old request settling neither clears the new flag nor counts as current', () => {
    const gate = createPendingSessionGate()
    const old = gate.start()
    gate.bump()
    const fresh = gate.start()
    gate.finish(old)
    expect(gate.inFlight()).toBe(true)
    expect(gate.isCurrent(old)).toBe(false)
    expect(gate.isCurrent(fresh)).toBe(true)
    gate.finish(fresh)
    expect(gate.inFlight()).toBe(false)
  })

  it('within one session a request still blocks a second one', () => {
    const gate = createPendingSessionGate()
    const g = gate.start()
    expect(shouldRefreshPending({ reason: 'focus', now: 1e6, lastFetchAt: 0, inFlight: gate.inFlight(), hidden: false })).toBe(false)
    gate.finish(g)
    expect(gate.inFlight()).toBe(false)
    expect(gate.generation).toBe(g)
  })

  it('the hook drops stale responses and resets per account', () => {
    const src = read('hooks/usePendingConnections.ts')
    expect(src).not.toMatch(/let inFlight\b/)
    expect(src).toMatch(/const gate = createPendingSessionGate\(\)/)
    expect(src).toMatch(/inFlight: gate\.inFlight\(\)/)
    expect(src).toMatch(/const generation = gate\.start\(\)/)
    // the stale check sits before the shared count is written
    const guard = src.indexOf('if (d == null || !gate.isCurrent(generation)) return')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(src.indexOf('sharedCount = countPendingReceived(d)'))
    // an old request's settle can't trigger a rerun in the new session
    expect(src).toMatch(/gate\.finish\(generation\)\s*if \(!gate\.isCurrent\(generation\)\) return\s*if \(rerunAfterFlight\)/)
    expect(src).toMatch(/function syncSession\(userId: string \| null\) \{\s*if \(userId === sessionUserId\) return\s*sessionUserId = userId\s*gate\.bump\(\)\s*sharedCount = 0\s*lastFetchAt = null\s*rerunAfterFlight = false/)
    expect(src).toMatch(/const userId = isLoggedIn \? user\.id : null/)
    expect(src).toMatch(/syncSession\(userId\)\s*if \(!isLoggedIn\)/)
    expect(src).toMatch(/\}, \[isLoggedIn, userId\]\)/)
  })
})

describe('c — BoardFeed offset after deleting the deep-linked post', () => {
  const feed = read('components/BoardFeed.tsx')
  it('tracks whether the prepended post came back in an appended page', () => {
    expect(feed).toMatch(/const prependedPaged = useRef\(false\)/)
    expect(feed).toMatch(/if \(!append\) \{ prependedId\.current = prepended; prependedPaged\.current = false \}/)
    expect(feed).toMatch(/else if \(prependedId\.current && next\.some\(p => p\.id === prependedId\.current\)\) prependedPaged\.current = true/)
    // recorded from the raw page, before the dedupe filters it out of posts
    expect(feed.indexOf('prependedPaged.current = true')).toBeLessThan(feed.indexOf('setPosts(prev => {'))
  })
  it('deleting it moves the offset back only when a page counted it', () => {
    expect(feed).toMatch(/if \(id !== prependedId\.current \|\| prependedPaged\.current\) nextOffset\.current = Math\.max\(0, nextOffset\.current - 1\)/)
  })
})
