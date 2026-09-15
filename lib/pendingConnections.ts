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

// Which account the badge's request belongs to. A fetch still out when the
// member signed out used to land afterwards and write their count into the
// shared state, so the next account's first mount showed it — and, since
// that old request also counted as in flight, the new account's own fetch was
// refused until the ≥15s gap allowed another. The hook bumps the generation
// on sign-out or a different user; an older generation's response is dropped
// and its request no longer blocks the current session.
export interface PendingSessionGate {
  readonly generation: number
  // A different account (or none): drop everything already out.
  bump(): void
  // Is a request for the *current* session out?
  inFlight(): boolean
  // Mark a request as out; returns the generation it belongs to.
  start(): number
  isCurrent(generation: number): boolean
  // The request from `generation` settled.
  finish(generation: number): void
}

export function createPendingSessionGate(): PendingSessionGate {
  let generation = 0
  let inFlightGeneration: number | null = null
  return {
    get generation() { return generation },
    bump() { generation++ },
    inFlight: () => inFlightGeneration === generation,
    start() { inFlightGeneration = generation; return generation },
    isCurrent: g => g === generation,
    finish(g) {
      // An old session's request settling must not clear the new one's flag.
      if (inFlightGeneration === g) inFlightGeneration = null
    },
  }
}
