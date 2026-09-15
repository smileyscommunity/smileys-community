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
}

export function createNotificationSync(): NotificationSync {
  let seq = 0
  let nextKey = 0
  const pending = new Map<number, PendingNotificationAction>()
  return {
    startPoll: () => seq,
    resolvePoll(token, list) {
      if (token !== seq) return null
      return overlayPending(list, pending.values())
    },
    begin(action) {
      const key = ++nextKey
      pending.set(key, action)
      seq++
      let settled = false
      return () => {
        if (settled) return
        settled = true
        pending.delete(key)
        // A poll that went out mid-request may still carry the old state.
        seq++
      }
    },
  }
}
