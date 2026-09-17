// ── Check-ins that couldn't reach the server ────────────────────────────────
//
// A boat, a basement bar, a park with one bar of signal: every tap at the door
// is its own PATCH, and a dropped connection used to roll the tap back with
// "No connection — try again". A host at the door doesn't try again; they
// move on to the next person, and the check-in is lost. Now a tap that fails
// for want of a network is kept on the device and sent when the connection
// returns. A tap the SERVER refuses (settled, not open yet, not an attendee)
// is still rolled back at once — retrying can't fix it.
//
// The queue rules and the one PATCH live here; persisting and flushing them
// is hooks/useCheckinSync.

export interface QueuedCheckin {
  eventId:   string
  userId:    string
  checkedIn: boolean
  at:        number
}

export type SendOutcome =
  | { kind: 'saved' }
  | { kind: 'offline' }
  | { kind: 'refused'; error: string }

export const CHECKIN_QUEUE_KEY = 'smileys:checkin-queue'

// A tap older than this is not replayed: the door it belongs to has long
// closed, and whoever holds the phone now isn't looking at that roster.
export const CHECKIN_QUEUE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

/** Add a tap. The latest tap for a person at an event replaces any earlier one. */
export function enqueue(queue: QueuedCheckin[], item: QueuedCheckin): QueuedCheckin[] {
  return [...dequeue(queue, item.eventId, item.userId), item]
}

export function dequeue(queue: QueuedCheckin[], eventId: string, userId: string): QueuedCheckin[] {
  return queue.filter(q => !(q.eventId === eventId && q.userId === userId))
}

export function pendingFor(queue: QueuedCheckin[], eventId: string): QueuedCheckin[] {
  return queue.filter(q => q.eventId === eventId)
}

export function freshOnly(queue: QueuedCheckin[], now: number = Date.now()): QueuedCheckin[] {
  return queue.filter(q => now - q.at <= CHECKIN_QUEUE_MAX_AGE_MS)
}

/**
 * Lay unsent taps over a roster just loaded from the server — the server
 * hasn't heard of them yet, and a reload must not show them undone.
 */
export function applyPending<A extends { userId: string; checkedIn: boolean; attendance?: string }>(
  rows: A[], pending: QueuedCheckin[],
): A[] {
  if (pending.length === 0) return rows
  const byUser = new Map(pending.map(p => [p.userId, p.checkedIn]))
  return rows.map(r => {
    const checkedIn = byUser.get(r.userId)
    return checkedIn === undefined ? r : { ...r, checkedIn, attendance: checkedIn ? 'attended' : 'unknown' }
  })
}

/**
 * Replay queued taps in order. Stops at the first network failure — still
 * offline, keep the rest for the next attempt. A refusal is dropped and
 * reported, so the page can undo that row.
 */
export async function flushQueue(
  items: QueuedCheckin[],
  send: (item: QueuedCheckin) => Promise<SendOutcome>,
): Promise<{ sent: QueuedCheckin[]; refused: { item: QueuedCheckin; error: string }[]; remaining: QueuedCheckin[] }> {
  const sent: QueuedCheckin[] = []
  const refused: { item: QueuedCheckin; error: string }[] = []
  for (let i = 0; i < items.length; i++) {
    const outcome = await send(items[i])
    if (outcome.kind === 'offline') return { sent, refused, remaining: items.slice(i) }
    if (outcome.kind === 'refused') refused.push({ item: items[i], error: outcome.error })
    else sent.push(items[i])
  }
  return { sent, refused, remaining: [] }
}

/** One door tap, classified: saved, no network (queue it), or refused by the server. */
/** `scannedAt`: the tap time, sent with a REPLAY so a check-in that waited past the settle point is still taken. */
export async function patchCheckin(eventId: string, userId: string, checkedIn: boolean, scannedAt?: number): Promise<SendOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'offline' }
  let res: Response
  try {
    res = await fetch(`/app/api/events/${eventId}/checkin`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, checkedIn, ...(scannedAt ? { scannedAt } : {}) }),
    })
  } catch {
    return { kind: 'offline' }
  }
  if (res.ok) return { kind: 'saved' }
  const d = await res.json().catch(() => null)
  return { kind: 'refused', error: typeof d?.error === 'string' ? d.error : 'Check-in update failed. Please try again.' }
}

function isQueuedCheckin(v: unknown): v is QueuedCheckin {
  const q = v as QueuedCheckin | null
  return !!q && typeof q.eventId === 'string' && typeof q.userId === 'string'
    && typeof q.checkedIn === 'boolean' && typeof q.at === 'number'
}

// Fail-soft storage: private mode, blocked site data or a full quota must
// never break the door — the tap then simply isn't kept.
export function loadQueue(): QueuedCheckin[] {
  try {
    const raw = localStorage.getItem(CHECKIN_QUEUE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isQueuedCheckin) : []
  } catch {
    return []
  }
}

export function saveQueue(queue: QueuedCheckin[]): void {
  try {
    if (queue.length > 0) localStorage.setItem(CHECKIN_QUEUE_KEY, JSON.stringify(queue))
    else localStorage.removeItem(CHECKIN_QUEUE_KEY)
  } catch {}
}
