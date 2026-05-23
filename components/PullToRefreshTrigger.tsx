'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'

export default function PullToRefreshTrigger() {
  const router = useRouter()

  const refresh = useCallback(async () => {
    router.refresh()
    await new Promise(r => setTimeout(r, 600))
  }, [router])

  const { pullY, refreshing, progress } = usePullToRefresh(refresh)

  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-all duration-200"
      style={{ height: pullY > 0 || refreshing ? `${Math.max(pullY, refreshing ? 48 : 0)}px` : 0 }}
    >
      <div
        className={`w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent ${refreshing ? 'animate-spin' : ''}`}
        style={{ opacity: progress, transform: `rotate(${progress * 180}deg) scale(${0.5 + progress * 0.5})` }}
      />
    </div>
  )
}
