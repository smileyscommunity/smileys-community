'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

const THRESHOLD = 72

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pullY,      setPullY]      = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const startY       = useRef(0)
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
    function onTouchStart(e: TouchEvent) {
      if (busy.current || window.scrollY > 0) return
      startY.current = e.touches[0].clientY
    }

    function onTouchMove(e: TouchEvent) {
      if (busy.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy > 0 && window.scrollY === 0) {
        const clamped = Math.min(dy * 0.45, THRESHOLD + 16)
        currentPullY.current = clamped
        setPullY(clamped)
      }
    }

    function onTouchEnd() {
      if (busy.current) return
      if (currentPullY.current >= THRESHOLD) {
        doRefresh()
      } else {
        currentPullY.current = 0
        setPullY(0)
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove',  onTouchMove,  { passive: true })
    window.addEventListener('touchend',   onTouchEnd)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove',  onTouchMove)
      window.removeEventListener('touchend',   onTouchEnd)
    }
  }, [doRefresh])

  const progress  = Math.min(pullY / THRESHOLD, 1)
  const triggered = refreshing || currentPullY.current >= THRESHOLD

  return { pullY, refreshing, progress, triggered }
}
