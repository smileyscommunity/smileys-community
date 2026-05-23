'use client'

import { useRef, useState } from 'react'

interface Props {
  onSwipeLeft?:  () => void
  onSwipeRight?: () => void
  threshold?: number
  children: React.ReactNode
  className?: string
}

export default function SwipeRow({ onSwipeLeft, onSwipeRight, threshold = 80, children, className }: Props) {
  const startX = useRef(0)
  const startY = useRef(0)
  const axis   = useRef<'h' | 'v' | null>(null)
  const [dx, setDx] = useState(0)

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    axis.current   = null
  }

  function onTouchMove(e: React.TouchEvent) {
    const deltaX = e.touches[0].clientX - startX.current
    const deltaY = e.touches[0].clientY - startY.current

    if (!axis.current) {
      if (Math.abs(deltaX) > Math.abs(deltaY) + 4) axis.current = 'h'
      else if (Math.abs(deltaY) > Math.abs(deltaX) + 4) axis.current = 'v'
    }
    if (axis.current !== 'h') return

    const min = onSwipeLeft  ? -(threshold * 1.4) : 0
    const max = onSwipeRight ?   threshold * 1.4  : 0
    setDx(Math.max(min, Math.min(max, deltaX)))
  }

  function onTouchEnd() {
    if (dx <= -threshold && onSwipeLeft)  onSwipeLeft()
    if (dx >=  threshold && onSwipeRight) onSwipeRight()
    setDx(0)
    axis.current = null
  }

  const showLeft  = dx < -20
  const showRight = dx >  20

  return (
    <div className={`relative overflow-hidden ${className ?? ''}`}>
      {onSwipeLeft && (
        <div className={`absolute right-0 inset-y-0 flex items-center justify-end px-5 bg-red-500 transition-opacity duration-100 ${showLeft ? 'opacity-100' : 'opacity-0'}`}>
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      {onSwipeRight && (
        <div className={`absolute left-0 inset-y-0 flex items-center px-5 bg-green-500 transition-opacity duration-100 ${showRight ? 'opacity-100' : 'opacity-0'}`}>
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? 'transform 0.2s ease' : 'none' }}
      >
        {children}
      </div>
    </div>
  )
}
