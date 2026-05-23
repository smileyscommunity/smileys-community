'use client'

import { useEffect, useRef, useState } from 'react'

export default function AnimatedCounter({ value, suffix = '+', duration = 1800 }: {
  value: number
  suffix?: string
  duration?: number
}) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true
        const start = performance.now()
        function tick(now: number) {
          const progress = Math.min((now - start) / duration, 1)
          const eased = 1 - Math.pow(1 - progress, 3)
          setDisplay(Math.floor(eased * value))
          if (progress < 1) requestAnimationFrame(tick)
          else setDisplay(value)
        }
        requestAnimationFrame(tick)
      }
    }, { threshold: 0.3 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [value, duration])

  return <span ref={ref}>{display.toLocaleString()}{suffix}</span>
}
