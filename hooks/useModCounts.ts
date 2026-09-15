'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import {
  MODERATION_CHANGED_EVENT, MOD_COUNTS_POLL_MS, createFetchGeneration,
  parseModCounts, shouldRefreshModCounts, type ModCounts, type ModRefreshReason,
} from '@/lib/modCounts'

// The topbar's moderation badges were fetched once on mount and never again,
// so approving the application or resolving the report they pointed at left
// the old number up until a full reload. They now refresh when the count
// plausibly changed: route changes, tab focus / becoming visible, the
// MODERATION_CHANGED event the queue pages fire after an action, and a slow
// poll that skips hidden tabs. Same shape as hooks/usePendingConnections.
//
// State lives at module level so a second consumer shares the one request
// (throttled in shouldRefreshModCounts) instead of firing its own.
let sharedCounts: ModCounts | null = null
let lastFetchAt: number | null = null
let inFlight = false
let rerunAfterFlight = false
const listeners = new Set<(c: ModCounts | null) => void>()
// Bumped on disable so a fetch still out for the previous user can't write.
const generation = createFetchGeneration()

function refresh(reason: ModRefreshReason) {
  // An action that lands while a fetch is out may postdate that fetch's read
  // — run once more when it returns rather than keep the pre-action count.
  if (reason === 'changed' && inFlight) { rerunAfterFlight = true; return }
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  if (!shouldRefreshModCounts({ reason, now: Date.now(), lastFetchAt, inFlight, hidden })) return
  inFlight = true
  lastFetchAt = Date.now()
  const gen = generation.start()
  fetch('/app/api/admin/mod-stats', { credentials: 'include' })
    .then(r => {
      if (r.status === 401 || r.status === 403) return { gone: true }  // no longer a moderator — hide
      if (!r.ok) return null                                          // transient failure keeps the last counts
      return r.json()
    })
    .then(d => {
      if (d == null || !generation.isCurrent(gen)) return
      if ((d as { gone?: boolean }).gone) {
        sharedCounts = null
      } else {
        const next = parseModCounts(d)
        if (!next) return  // unexpected body — keep what's on screen
        sharedCounts = next
      }
      listeners.forEach(l => l(sharedCounts))
    })
    .catch(() => {})
    .finally(() => {
      // Disable already reset the flight flags; a stale flight must not clear
      // a newer user's inFlight or queue a rerun for them.
      if (!generation.isCurrent(gen)) return
      inFlight = false
      if (rerunAfterFlight) { rerunAfterFlight = false; refresh('changed') }
    })
}

export function useModCounts(enabled: boolean): ModCounts | null {
  const pathname = usePathname()
  const [counts, setCounts] = useState<ModCounts | null>(sharedCounts)

  useEffect(() => {
    if (!enabled) {
      // Not a moderator (or signed out): the next user on this device must
      // not inherit the counts.
      // A fetch already out is orphaned by the bump, and the flight flags
      // reset so the next moderator's mount fetches straight away.
      generation.bump()
      sharedCounts = null
      lastFetchAt = null
      inFlight = false
      rerunAfterFlight = false
      setCounts(null)
      return
    }
    listeners.add(setCounts)
    setCounts(sharedCounts)
    refresh('mount')
    const onFocus   = () => refresh('focus')
    const onVisible = () => { if (document.visibilityState === 'visible') refresh('visible') }
    const onChanged = () => refresh('changed')
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(MODERATION_CHANGED_EVENT, onChanged)
    const t = setInterval(() => refresh('poll'), MOD_COUNTS_POLL_MS)
    return () => {
      listeners.delete(setCounts)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(MODERATION_CHANGED_EVENT, onChanged)
      clearInterval(t)
    }
  }, [enabled])

  useEffect(() => {
    if (enabled) refresh('route')
  }, [pathname, enabled])

  return enabled ? counts : null
}
