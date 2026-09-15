import { toast } from 'sonner'
import { toastApiError } from '@/lib/apiError'

// Shared by the navbar bell and /notifications. Both used to `await fetch()`
// and then update the list whatever came back, so a 429 (the route allows
// 60/min), a 500 or a dropped connection looked like success until the next
// poll quietly brought the notification back. Callers apply their change
// optimistically and roll it back when this resolves false; the toast carries
// the server's own message when there is one.
export async function sendNotificationAction(
  method: 'PATCH' | 'DELETE',
  body: Record<string, unknown>,
  fallback: string,
): Promise<boolean> {
  try {
    const res = await fetch('/app/api/notifications', {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { await toastApiError(res, fallback); return false }
    return true
  } catch {
    toast.error(`${fallback} — check your connection`)
    return false
  }
}

export function setReadFor<T extends { id: string; isRead: boolean }>(list: T[], ids: Set<string>, isRead: boolean): T[] {
  return list.map(n => ids.has(n.id) ? { ...n, isRead } : n)
}

// Put a dismissed notification back where it was — unless a poll that landed
// in between already brought it back, which would otherwise duplicate it.
export function restoreAt<T extends { id: string }>(list: T[], item: T, index: number): T[] {
  if (list.some(x => x.id === item.id)) return list
  const i = Math.max(0, Math.min(index, list.length))
  return [...list.slice(0, i), item, ...list.slice(i)]
}

// A poll that answered while a mark-read/dismiss was still in flight used to
// replace the whole list with the server's pre-action copy: the row came back
// (or went unread) until the next poll, and a second ✕ on it could then fail
// and roll back with "Could not dismiss". Each caller keeps one of these:
// actions register while their request is out and are overlaid onto every
// poll result, and a poll started before the latest action began or settled
// is dropped outright — its read may predate the server's write.
export type PendingNotificationAction =
  | { kind: 'read'; ids: ReadonlySet<string> }
  | { kind: 'dismiss'; id: string }
  // Nothing to overlay (clear-all only empties the list once the server
  // agrees) — it just invalidates polls already out.
  | { kind: 'hold' }

export function overlayPending<T extends { id: string; isRead: boolean }>(
  list: T[],
  actions: Iterable<PendingNotificationAction>,
): T[] {
  let out = list
  for (const a of actions) {
    if (a.kind === 'read') out = setReadFor(out, new Set(a.ids), true)
    else if (a.kind === 'dismiss') out = out.filter(n => n.id !== a.id)
  }
  return out
}

export interface NotificationSync {
  // Call as the fetch goes out; hand the token back to resolvePoll.
  startPoll(): number
  // The list to render, or null when the response is stale and must be ignored.
  resolvePoll<T extends { id: string; isRead: boolean }>(token: number, list: T[]): T[] | null
  // Register an action whose request is going out; call the returned settle
  // once it resolves (before any rollback). Settling twice is harmless.
  begin(action: PendingNotificationAction): () => void
  // A change the other list (or another tab) already made on the server. It
  // counts as newer than any poll out now, but rather than dropping that poll
  // the change is replayed onto it — dropping /notifications' first load left
  // it on "all caught up" until the tab was refocused.
  receive(change: NotificationChange): void
}

export function createNotificationSync(): NotificationSync {
  let seq = 0
  let nextKey = 0
  // Polls started before this are dropped outright: a local action began or
  // settled since, so their read may predate the server's write.
  let floor = 0
  const pending = new Map<number, PendingNotificationAction>()
  // Received changes newer than floor, each with the seq it bumped to.
  const received: { seq: number; change: NotificationChange }[] = []
  const raiseFloor = (to: number) => {
    floor = to
    while (received.length && received[0].seq <= floor) received.shift()
  }
  return {
    startPoll: () => seq,
    resolvePoll(token, list) {
      if (token < floor) return null
      let out = list
      for (const r of received) if (r.seq > token) out = applyNotificationChange(out, r.change)
      return overlayPending(out, pending.values())
    },
    begin(action) {
      const key = ++nextKey
      pending.set(key, action)
      raiseFloor(++seq)
      let settled = false
      return () => {
        if (settled) return
        settled = true
        pending.delete(key)
        // A poll that went out mid-request may still carry the old state.
        raiseFloor(++seq)
      }
    },
    receive(change) {
      received.push({ seq: ++seq, change })
      // Bounded: past this, polls older than the oldest kept change just drop.
      if (received.length > 20) raiseFloor(received[0].seq)
    },
  }
}

// ── Bell ⇄ /notifications ⇄ other tabs ─────────────────────────────────────
// Each list kept its own copy, so marking read or dismissing on the page left
// the bell badge counting it until its next 60s poll (and vice versa). After a
// SUCCESSFUL action the list emits what changed; the others apply it locally.
// Same tab: a window event. Other tabs: a BroadcastChannel where there is one.

export const NOTIFICATIONS_CHANGED_EVENT = 'smileys:notifications-changed'
export const NOTIFICATIONS_CHANNEL = 'smileys:notifications'

export type NotificationChange =
  | { kind: 'read' | 'dismiss'; ids: string[] }
  | { kind: 'readAll' | 'clearAll' }

// `tab` and `source` say who sent it, so the sender never applies it twice.
export interface NotificationChangeMessage {
  change: NotificationChange
  tab:    string
  source: string
}

export function applyNotificationChange<T extends { id: string; isRead: boolean }>(
  list: T[],
  change: NotificationChange,
): T[] {
  switch (change.kind) {
    case 'read':     return setReadFor(list, new Set(change.ids), true)
    case 'dismiss': {
      const ids = new Set(change.ids)
      return list.filter(n => !ids.has(n.id))
    }
    case 'readAll':  return list.some(n => !n.isRead) ? list.map(n => n.isRead ? n : { ...n, isRead: true }) : list
    case 'clearAll': return list.length ? [] : list
  }
}

// Channel messages come from other tabs (possibly an older build) — accept
// only the exact shape.
export function parseNotificationChangeMessage(data: unknown): NotificationChangeMessage | null {
  if (!data || typeof data !== 'object') return null
  const { change, tab, source } = data as Record<string, unknown>
  if (typeof tab !== 'string' || typeof source !== 'string') return null
  if (!change || typeof change !== 'object') return null
  const { kind, ids } = change as Record<string, unknown>
  if (kind === 'readAll' || kind === 'clearAll') return { change: { kind }, tab, source }
  if (kind !== 'read' && kind !== 'dismiss') return null
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) return null
  return { change: { kind, ids: [...ids] }, tab, source }
}

// Per page load. Window events are same-tab by definition, so they're matched
// on source; channel messages are skipped when this tab sent them, because the
// window event already delivered them here.
const TAB_ID = Math.random().toString(36).slice(2)
let nextSource = 0

export function createNotificationSourceId(): string {
  return `${TAB_ID}:${++nextSource}`
}

export function shouldApplyNotificationMessage(
  msg: NotificationChangeMessage,
  self: { tab: string; source: string },
  via: 'window' | 'channel',
): boolean {
  return via === 'window' ? msg.source !== self.source : msg.tab !== self.tab
}

interface ChannelLike {
  postMessage(message: unknown): void
  close(): void
  onmessage: ((ev: { data: unknown }) => void) | null
}

// Injectable so tests can drive it without a browser.
export interface NotificationChangeEnv {
  target:      EventTarget | null
  openChannel: () => ChannelLike | null
  tab:         string
}

function browserEnv(): NotificationChangeEnv {
  return {
    target: typeof window === 'undefined' ? null : window,
    openChannel: () => {
      try {
        return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NOTIFICATIONS_CHANNEL) as unknown as ChannelLike
      } catch { return null }
    },
    tab: TAB_ID,
  }
}

// Call only once the server has accepted the action — never on a rollback.
// Deliberately not tied to a mounted component: /notifications navigates away
// on click, and its read receipt must still reach the bell.
export function emitNotificationChange(
  change: NotificationChange,
  source: string,
  env: NotificationChangeEnv = browserEnv(),
): void {
  const msg: NotificationChangeMessage = { change, tab: env.tab, source }
  env.target?.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT, { detail: msg }))
  // A short-lived channel: delivery is queued at postMessage, so closing the
  // sender straight away loses nothing and keeps no channel open per tab.
  const ch = env.openChannel()
  if (!ch) return
  try { ch.postMessage(msg) } catch { /* no cross-tab sync this time */ } finally { ch.close() }
}

// Returns the cleanup for a useEffect.
export function subscribeNotificationChanges(
  source: string,
  onChange: (change: NotificationChange) => void,
  env: NotificationChangeEnv = browserEnv(),
): () => void {
  const self = { tab: env.tab, source }
  const deliver = (data: unknown, via: 'window' | 'channel') => {
    const msg = parseNotificationChangeMessage(data)
    if (msg && shouldApplyNotificationMessage(msg, self, via)) onChange(msg.change)
  }
  const onEvent = (e: Event) => deliver((e as CustomEvent).detail, 'window')
  env.target?.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onEvent)
  const ch = env.openChannel()
  if (ch) ch.onmessage = ev => deliver(ev.data, 'channel')
  return () => {
    env.target?.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onEvent)
    if (ch) { ch.onmessage = null; ch.close() }
  }
}
