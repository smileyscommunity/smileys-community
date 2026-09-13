// Pending-connections badge (Navbar + BottomNav) — the pure half of
// hooks/usePendingConnections, so the refresh policy is testable without React.

// Fired on window after the member accepts, declines or otherwise changes a
// connection anywhere in the app, so the badge doesn't sit on a stale count
// until the next full page load.
export const CONNECTIONS_CHANGED_EVENT = 'smileys:connections-changed'

export function notifyConnectionsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CONNECTIONS_CHANGED_EVENT))
}

// GET /api/connections → how many received requests still await an answer.
// A 401 `{ error }` body (expired session) or a non-object reads as 0.
export function countPendingReceived(body: unknown): number {
  if (!body || typeof body !== 'object') return 0
  const received = (body as { received?: unknown }).received
  if (!Array.isArray(received)) return 0
  return received.filter(c => !!c && typeof c === 'object' && (c as { status?: unknown }).status === 'pending').length
}

// Slowest background cadence (only while visible) and the floor between
// opportunistic refetches — focus, visibilitychange and route changes can fire
// together, and two components share the one request.
export const PENDING_POLL_MS     = 60_000
export const PENDING_MIN_GAP_MS  = 15_000

export type RefreshReason = 'mount' | 'focus' | 'visible' | 'route' | 'changed' | 'poll'

export function shouldRefreshPending(opts: {
  reason: RefreshReason
  now: number
  lastFetchAt: number | null
  inFlight: boolean
  hidden: boolean
}): boolean {
  const { reason, now, lastFetchAt, inFlight, hidden } = opts
  if (inFlight) return false
  // A background tab never polls; it catches up on 'visible'.
  if (hidden) return false
  // The member just acted on a request — always worth a fresh count.
  if (reason === 'changed' || lastFetchAt == null) return true
  return now - lastFetchAt >= PENDING_MIN_GAP_MS
}
