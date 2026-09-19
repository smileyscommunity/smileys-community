'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { armPull, pullDistance, PULL_THRESHOLD as THRESHOLD } from '@/lib/pullToRefresh'

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pullY,      setPullY]      = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // null = no gesture armed. Only a touch that starts at the very top arms
  // one, and it's disarmed when that touch ends (lib/pullToRefresh has why).
  const startY       = useRef<number | null>(null)
  const currentPullY = useRef(0)
  const busy         = useRef(false)

  const doRefresh = useCallback(async () => {
    busy.current = true
    setRefreshing(true)
    currentPullY.current = 0
    setPullY(0)
    try { await onRefresh() } finally {
      setRefreshing(false)
      busy.current = false
    }
  }, [onRefresh])

  useEffect(() => {
    function reset() {
      startY.current = null
      if (currentPullY.current !== 0) {
        currentPullY.current = 0
        setPullY(0)
      }
    }

    function onTouchStart(e: TouchEvent) {
      startY.current = armPull({ busy: busy.current, scrollY: window.scrollY, clientY: e.touches[0].clientY })
    }

    function onTouchMove(e: TouchEvent) {
      if (busy.current || startY.current === null) return
      const next = pullDistance({ startY: startY.current, clientY: e.touches[0].clientY, scrollY: window.scrollY })
      if (next !== currentPullY.current) {
        currentPullY.current = next
        setPullY(next)
      }
    }

    function onTouchEnd() {
      const armed = startY.current !== null
      if (busy.current) { startY.current = null; return }
      if (armed && currentPullY.current >= THRESHOLD) {
        startY.current = null
        doRefresh()
      } else {
        reset()
      }
    }

    // A cancelled touch (the OS took it — a notification, a system gesture)
    // never refreshes; it just lets go.
    function onTouchCancel() {
      if (busy.current) { startY.current = null; return }
      reset()
    }

    window.addEventListener('touchstart',  onTouchStart,  { passive: true })
    window.addEventListener('touchmove',   onTouchMove,   { passive: true })
    window.addEventListener('touchend',    onTouchEnd)
    window.addEventListener('touchcancel', onTouchCancel)
    return () => {
      window.removeEventListener('touchstart',  onTouchStart)
      window.removeEventListener('touchmove',   onTouchMove)
      window.removeEventListener('touchend',    onTouchEnd)
      window.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [doRefresh])

  const progress  = Math.min(pullY / THRESHOLD, 1)
  const triggered = refreshing || currentPullY.current >= THRESHOLD

  return { pullY, refreshing, progress, triggered }
}
