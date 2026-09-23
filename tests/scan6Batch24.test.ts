import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import {
  applyNotificationChange, createNotificationSync, createNotificationSourceId,
  emitNotificationChange, parseNotificationChangeMessage, shouldApplyNotificationMessage,
  subscribeNotificationChanges, NOTIFICATIONS_CHANGED_EVENT,
  type NotificationChange, type NotificationChangeEnv,
} from '@/lib/notificationActions'

// Scan 6, batch 24 — the navbar bell and /notifications each kept their own
// list. Marking read / dismissing / mark-all / clear-all in one left the other
// stale until its next poll (60s for the bell), so the badge counted what the
// member had just read on the page. A successful action now emits the change
// (window event in this tab, BroadcastChannel to other tabs) and the other list
// applies it locally.

const read = (f: string) => readFileSync(f, 'utf8')

type N = { id: string; isRead: boolean }
const server = (): N[] => [{ id: 'a', isRead: false }, { id: 'b', isRead: false }, { id: 'c', isRead: true }]

describe('applyNotificationChange', () => {
  it("'read' marks just those ids read", () => {
    expect(applyNotificationChange(server(), { kind: 'read', ids: ['a'] }))
      .toEqual([{ id: 'a', isRead: true }, { id: 'b', isRead: false }, { id: 'c', isRead: true }])
  })
  it("'dismiss' removes those ids and ignores unknown ones", () => {
    expect(applyNotificationChange(server(), { kind: 'dismiss', ids: ['b', 'zz'] }).map(n => n.id)).toEqual(['a', 'c'])
  })
  it("'readAll' marks every row read; a list with nothing unread is returned as is", () => {
    expect(applyNotificationChange(server(), { kind: 'readAll' }).every(n => n.isRead)).toBe(true)
    const allRead = [{ id: 'c', isRead: true }]
    expect(applyNotificationChange(allRead, { kind: 'readAll' })).toBe(allRead)
  })
  it("'clearAll' empties the list", () => {
    expect(applyNotificationChange(server(), { kind: 'clearAll' })).toEqual([])
  })
})

describe('parseNotificationChangeMessage', () => {
  it('accepts the four shapes', () => {
    for (const change of [
      { kind: 'read', ids: ['a'] }, { kind: 'dismiss', ids: ['a', 'b'] }, { kind: 'readAll' }, { kind: 'clearAll' },
    ] as NotificationChange[]) {
      expect(parseNotificationChangeMessage({ change, tab: 't', source: 's' })).toEqual({ change, tab: 't', source: 's' })
    }
  })
  it('rejects anything else a foreign or older tab might post', () => {
    for (const bad of [
      null, 'x', {}, { change: { kind: 'readAll' } },
      { change: { kind: 'nuke' }, tab: 't', source: 's' },
      { change: { kind: 'read' }, tab: 't', source: 's' },
      { change: { kind: 'dismiss', ids: [1] }, tab: 't', source: 's' },
    ]) expect(parseNotificationChangeMessage(bad)).toBeNull()
  })
})

describe('shouldApplyNotificationMessage — no echo', () => {
  const msg = { change: { kind: 'readAll' } as NotificationChange, tab: 'T1', source: 'T1:1' }
  it('a window event is ignored by its sender and applied by the other list in the tab', () => {
    expect(shouldApplyNotificationMessage(msg, { tab: 'T1', source: 'T1:1' }, 'window')).toBe(false)
    expect(shouldApplyNotificationMessage(msg, { tab: 'T1', source: 'T1:2' }, 'window')).toBe(true)
  })
  it('a channel message is ignored in the sending tab (the window event covered it) and applied elsewhere', () => {
    expect(shouldApplyNotificationMessage(msg, { tab: 'T1', source: 'T1:2' }, 'channel')).toBe(false)
    expect(shouldApplyNotificationMessage(msg, { tab: 'T2', source: 'T2:1' }, 'channel')).toBe(true)
  })
  it('source ids are unique per list', () => {
    expect(createNotificationSourceId()).not.toBe(createNotificationSourceId())
  })
})

describe('createNotificationSync.receive', () => {
  it('a stale in-flight poll cannot undo a received change', () => {
    const sync = createNotificationSync()
    const poll = sync.startPoll()
    sync.receive({ kind: 'dismiss', ids: ['a'] })
    // served from before the other list's DELETE — the change is replayed on it
    expect(sync.resolvePoll(poll, server())!.map(n => n.id)).toEqual(['b', 'c'])
  })

  it('a received change bumps the sequence past the older poll', () => {
    const sync = createNotificationSync()
    const poll = sync.startPoll()
    sync.receive({ kind: 'readAll' })
    expect(sync.startPoll()).toBeGreaterThan(poll)
    expect(sync.resolvePoll(poll, server())!.filter(n => !n.isRead)).toHaveLength(0)
    // a poll started after it is served as is
    const list = server()
    expect(sync.resolvePoll(sync.startPoll(), list)).toBe(list)
  })

  it('an older poll is still dropped when a local action began since', () => {
    const sync = createNotificationSync()
    const poll = sync.startPoll()
    sync.receive({ kind: 'read', ids: ['a'] })
    sync.begin({ kind: 'dismiss', id: 'b' })
    expect(sync.resolvePoll(poll, server())).toBeNull()
  })

  it('replays alongside a pending local action', () => {
    const sync = createNotificationSync()
    const settle = sync.begin({ kind: 'dismiss', id: 'b' })
    const poll = sync.startPoll()
    sync.receive({ kind: 'read', ids: ['a'] })
    expect(sync.resolvePoll(poll, server())).toEqual([{ id: 'a', isRead: true }, { id: 'c', isRead: true }])
    settle()
  })

  it('is bounded: past 20 received changes the oldest polls drop instead of replaying', () => {
    const sync = createNotificationSync()
    const poll = sync.startPoll()
    for (let i = 0; i < 21; i++) sync.receive({ kind: 'read', ids: [`x${i}`] })
    expect(sync.resolvePoll(poll, server())).toBeNull()
    const later = sync.startPoll()
    expect(sync.resolvePoll(later, server())).toEqual(server())
  })
})

// A tiny in-process BroadcastChannel: postMessage reaches every OTHER open
// instance, like the real one.
function makeHub() {
  const open = new Set<{ onmessage: ((ev: { data: unknown }) => void) | null }>()
  let opened = 0, closed = 0
  const openChannel = () => {
    opened++
    const ch = {
      onmessage: null as ((ev: { data: unknown }) => void) | null,
      postMessage(data: unknown) {
        const copy = JSON.parse(JSON.stringify(data))
        for (const other of open) if (other !== ch) other.onmessage?.({ data: copy })
      },
      close() { if (open.delete(ch)) closed++ },
    }
    open.add(ch)
    return ch
  }
  return { openChannel, stats: () => ({ opened, closed, open: open.size }) }
}

const tabEnv = (tab: string, hub: ReturnType<typeof makeHub>): NotificationChangeEnv =>
  ({ target: new EventTarget(), openChannel: hub.openChannel, tab })

describe('emit / subscribe', () => {
  it('same tab: the other list applies it, the sender does not', () => {
    const hub = makeHub()
    const env = tabEnv('T1', hub)
    const bell: NotificationChange[] = [], page: NotificationChange[] = []
    const offBell = subscribeNotificationChanges('T1:bell', c => bell.push(c), env)
    const offPage = subscribeNotificationChanges('T1:page', c => page.push(c), env)
    emitNotificationChange({ kind: 'read', ids: ['a'] }, 'T1:page', env)
    expect(bell).toEqual([{ kind: 'read', ids: ['a'] }])
    // neither the window event nor this tab's own channel delivery echoes back
    expect(page).toEqual([])
    offBell(); offPage()
  })

  it('other tabs: every list there applies it exactly once', () => {
    const hub = makeHub()
    const t1 = tabEnv('T1', hub), t2 = tabEnv('T2', hub)
    const got: string[] = []
    const offs = [
      subscribeNotificationChanges('T1:bell', c => got.push(`T1 bell ${c.kind}`), t1),
      subscribeNotificationChanges('T2:bell', c => got.push(`T2 bell ${c.kind}`), t2),
      subscribeNotificationChanges('T2:page', c => got.push(`T2 page ${c.kind}`), t2),
    ]
    emitNotificationChange({ kind: 'clearAll' }, 'T1:page', t1)
    expect(got.sort()).toEqual(['T1 bell clearAll', 'T2 bell clearAll', 'T2 page clearAll'])
    offs.forEach(off => off())
  })

  it('the emit channel is closed straight away; unsubscribing removes the listener and closes its channel', () => {
    const hub = makeHub()
    const env = tabEnv('T1', hub)
    const got: NotificationChange[] = []
    const off = subscribeNotificationChanges('T1:bell', c => got.push(c), env)
    emitNotificationChange({ kind: 'readAll' }, 'T1:page', env)
    expect(hub.stats()).toEqual({ opened: 2, closed: 1, open: 1 })
    off()
    expect(hub.stats().open).toBe(0)
    env.target!.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT, {
      detail: { change: { kind: 'clearAll' }, tab: 'T1', source: 'T1:page' },
    }))
    expect(got).toEqual([{ kind: 'readAll' }])
  })

  it('without BroadcastChannel or window it falls back silently', () => {
    const got: NotificationChange[] = []
    const env: NotificationChangeEnv = { target: new EventTarget(), openChannel: () => null, tab: 'T1' }
    const off = subscribeNotificationChanges('T1:bell', c => got.push(c), env)
    expect(() => emitNotificationChange({ kind: 'readAll' }, 'T1:page', env)).not.toThrow()
    expect(got).toHaveLength(1)
    off()
    const bare: NotificationChangeEnv = { target: null, openChannel: () => null, tab: 'T1' }
    expect(() => subscribeNotificationChanges('x', () => {}, bare)()).not.toThrow()
    expect(() => emitNotificationChange({ kind: 'readAll' }, 'x', bare)).not.toThrow()
  })

  it('a channel that throws on post is still closed', () => {
    let closed = false
    const env: NotificationChangeEnv = {
      target: null, tab: 'T1',
      openChannel: () => ({ onmessage: null, postMessage() { throw new Error('DataCloneError') }, close() { closed = true } }),
    }
    expect(() => emitNotificationChange({ kind: 'readAll' }, 'x', env)).not.toThrow()
    expect(closed).toBe(true)
  })
})

describe('bell and notifications page wiring', () => {
  it.each([
    ['components/NotificationBell.tsx', 'setNotifs'],
    ['app/(member)/notifications/page.tsx', 'setNotifications'],
  ])('%s subscribes with cleanup and emits only after success', (file, setter) => {
    const src = read(file)
    expect(src).toMatch(/const \[source\] = useState\(createNotificationSourceId\)/)
    // subscribe inside an effect whose cleanup is the unsubscribe; receive
    // counts as newer before the list is touched
    expect(src).toMatch(new RegExp(`useEffect\\(\\(\\) => \\{\\s*return subscribeNotificationChanges\\(source, change => \\{\\s*sync\\.receive\\(change\\)\\s*${setter}\\(prev => applyNotificationChange\\(prev, change\\)\\)`))
    // the counts follow the same change, and the effect's cleanup is still
    // the unsubscribe. The bell carries a second one — the badge, which is
    // what arrived since the member last opened it — and reading a row in
    // another tab has to settle that too, or the dot keeps counting something
    // the member has already dealt with.
    expect(src).toMatch(/setUnread\(c => unreadCountAfterChange\(c, change\)\)\s*(?:\/\/[^\n]*\n\s*)*(?:setBadge\(c => unreadCountAfterChange\(c, change\)\)\s*)?\}\)\s*\}, \[source, sync\]\)/)
    // mark-all: rollback (list and counts) returns before the emit
    expect(src).toMatch(new RegExp(`\\.finally\\(settle\\)\\) \\{\\s*${setter}\\(prev => setReadFor\\(prev, ids, false\\)\\)\\s*setUnread\\(before\\)\\s*(?:setBadge\\(beforeBadge\\)\\s*)?return\\s*\\}\\s*(?://[^\\n]*\\n\\s*)*emitNotificationChange\\(\\{ kind: 'readAll' \\}, source\\)`))
    // dismiss: restore returns before the emit. The window holds both count
    // rollbacks — the bell puts back `unread` and `badge` on the same line —
    // and is still far too short for anything else to hide in.
    expect(src).toMatch(new RegExp(`${setter}\\(prev => restoreAt\\(prev, (?:removed, index|entry\\.row, entry\\.index)\\)\\)[\\s\\S]{0,120}?return\\s*\\}\\s*emitNotificationChange\\(\\{ kind: 'dismiss', ids: \\[id\\] \\}, source\\)`))
    // single read: emit only on the ok branch
    expect(src).toMatch(new RegExp(`if \\(!ok\\) \\{?\\s*${setter}\\(prev => setReadFor\\(prev, ids, false\\)\\)[\\s\\S]{0,120}?(?://[^\\n]*\\n\\s*)*else emitNotificationChange\\(\\{ kind: 'read', ids: \\[n\\.id\\] \\}, source\\)`))
    // no emit anywhere else (e.g. before the request, or on a rollback path)
    const expected = file.includes('page.tsx') ? 4 : 3
    expect(src.match(/emitNotificationChange\(/g)).toHaveLength(expected)
  })

  it('clear-all emits inside the res.ok branch only', () => {
    const src = read('app/(member)/notifications/page.tsx')
    expect(src).toMatch(/if \(res\.ok\) \{\s*clearedAt\.current = Date\.now\(\)[\s\S]{0,300}?setNotifications\(\[\]\)[\s\S]{0,200}?setConfirmClear\(false\)\s*emitNotificationChange\(\{ kind: 'clearAll' \}, source\)[\s\S]{0,300}?\} else \{/)
  })

  it('the helpers stay in lib/notificationActions (no per-component copies)', () => {
    for (const f of ['components/NotificationBell.tsx', 'app/(member)/notifications/page.tsx']) {
      const src = read(f)
      expect(src).not.toMatch(/new BroadcastChannel|addEventListener\(['"]smileys:notifications-changed/)
    }
  })
})
