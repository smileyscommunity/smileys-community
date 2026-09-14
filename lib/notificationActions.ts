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
