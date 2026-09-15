'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import {
  CONNECTIONS_CHANGED_EVENT, PENDING_POLL_MS,
  countPendingReceived, shouldRefreshPending, createPendingSessionGate, type RefreshReason,
} from '@/lib/pendingConnections'

// The badge was fetched once on mount and then never again, so a request
// that arrived — or one the member accepted on /contacts — didn't show until
// a full page load. It now refreshes when the count plausibly changed: tab
// focus / becoming visible, route changes, the in-app CONNECTIONS_CHANGED
// event, and a slow poll that skips hidden tabs.
//
// State lives at module level because Navbar and BottomNav both mount this
// hook: they share one request (throttled in shouldRefreshPending) instead of
// each firing their own on every trigger.
let sharedCount = 0
let lastFetchAt: number | null = null
let rerunAfterFlight = false
// Requests belong to the session that sent them (see createPendingSessionGate).
const gate = createPendingSessionGate()
let sessionUserId: string | null = null
const listeners = new Set<(n: number) => void>()

function refresh(reason: RefreshReason) {
  // An action that lands while a fetch is out may postdate that fetch's read
  // — run once more when it returns rather than keep a pre-accept count.
  if (reason === 'changed' && gate.inFlight()) { rerunAfterFlight = true; return }
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  if (!shouldRefreshPending({ reason, now: Date.now(), lastFetchAt, inFlight: gate.inFlight(), hidden })) return
  const generation = gate.start()
  lastFetchAt = Date.now()
  fetch('/app/api/connections', { credentials: 'include' })
    .then(r => {
      if (r.status === 401) return { received: [] }  // session gone — nothing pending
      if (!r.ok) return null                          // transient failure keeps the last count
      return r.json()
    })
    .then(d => {
      // Sent for an account that has since signed out — not this badge's count.
      if (d == null || !gate.isCurrent(generation)) return
      sharedCount = countPendingReceived(d)
      listeners.forEach(l => l(sharedCount))
    })
    .catch(() => {})
    .finally(() => {
      gate.finish(generation)
      if (!gate.isCurrent(generation)) return
      if (rerunAfterFlight) { rerunAfterFlight = false; refresh('changed') }
    })
}

// Module-level like the rest, so Navbar and BottomNav bump it once between them.
function syncSession(userId: string | null) {
  if (userId === sessionUserId) return
  sessionUserId = userId
  gate.bump()
  sharedCount = 0
  lastFetchAt = null
  rerunAfterFlight = false
}

export function usePendingConnections() {
  const { user, isLoggedIn } = useAuth()
  const userId = isLoggedIn ? user.id : null
  const pathname = usePathname()
  const [count, setCount] = useState(sharedCount)

  useEffect(() => {
    // Signed out or a different account: the next member on this device must
    // not inherit the count, nor wait on the previous member's request.
    syncSession(userId)
    if (!isLoggedIn) {
      setCount(0)
      return
    }
    listeners.add(setCount)
    setCount(sharedCount)
    refresh('mount')
    const onFocus   = () => refresh('focus')
    const onVisible = () => { if (document.visibilityState === 'visible') refresh('visible') }
    const onChanged = () => refresh('changed')
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(CONNECTIONS_CHANGED_EVENT, onChanged)
    const t = setInterval(() => refresh('poll'), PENDING_POLL_MS)
    return () => {
      listeners.delete(setCount)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(CONNECTIONS_CHANGED_EVENT, onChanged)
      clearInterval(t)
    }
  }, [isLoggedIn, userId])

  useEffect(() => {
    if (isLoggedIn) refresh('route')
  }, [pathname, isLoggedIn])

  return isLoggedIn ? count : 0
}
