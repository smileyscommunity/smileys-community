// Admin topbar moderation counts (pending applications / reports / queued
// events) — the pure half of hooks/useModCounts, so the refresh policy is
// testable without React. Mirrors lib/pendingConnections.

// Fired on window after a moderator approves/rejects an application, resolves
// a report, or publishes a queued event, so the topbar badge doesn't sit on a
// stale count until the next full page load.
export const MODERATION_CHANGED_EVENT = 'smileys:moderation-changed'

export function notifyModerationChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(MODERATION_CHANGED_EVENT))
}

export interface ModCounts {
  pendingApplications: number
  pendingReports:      number
  approvalQueueEvents: number
  /** "I was there", waiting on a decision. */
  standingDisputes:    number
}

// GET /api/admin/mod-stats → the badge counts, or null for a body that isn't
// one (an error payload must not render as "0 of everything").
export function parseModCounts(body: unknown): ModCounts | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  const apps = n(b.pendingApplications), reports = n(b.pendingReports), events = n(b.approvalQueueEvents)
  if (apps === null || reports === null || events === null) return null
  // Tolerated as missing: an older deployment's response is still a usable
  // body for the three counts that have always been there, and a badge that
  // renders 0 beats a sidebar that renders none.
  return {
    pendingApplications: apps, pendingReports: reports, approvalQueueEvents: events,
    standingDisputes: n(b.standingDisputes) ?? 0,
  }
}

// Slowest background cadence (only while visible) and the floor between
// opportunistic refetches — focus, visibilitychange and a route change often
// fire together.
export const MOD_COUNTS_POLL_MS    = 60_000
export const MOD_COUNTS_MIN_GAP_MS = 15_000

// Generation guard for the hook's shared counts. Disabling (sign-out, demotion)
// bumps the generation; a fetch that started under an older one must not write
// when it lands, or the next moderator on this device sees the last one's
// counts.
export interface FetchGeneration {
  start():              number
  bump():               void
  isCurrent(g: number): boolean
}

export function createFetchGeneration(): FetchGeneration {
  let generation = 0
  return {
    start:     () => generation,
    bump:      () => { generation += 1 },
    isCurrent: g => g === generation,
  }
}

export type ModRefreshReason = 'mount' | 'focus' | 'visible' | 'route' | 'changed' | 'poll'

export function shouldRefreshModCounts(opts: {
  reason:      ModRefreshReason
  now:         number
  lastFetchAt: number | null
  inFlight:    boolean
  hidden:      boolean
}): boolean {
  const { reason, now, lastFetchAt, inFlight, hidden } = opts
  if (inFlight) return false
  // A background tab never polls; it catches up on 'visible'.
  if (hidden) return false
  // The moderator just acted on the queue — always worth a fresh count.
  if (reason === 'changed' || lastFetchAt == null) return true
  return now - lastFetchAt >= MOD_COUNTS_MIN_GAP_MS
}
