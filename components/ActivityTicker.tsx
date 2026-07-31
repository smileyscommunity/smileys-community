'use client'

import { useState } from 'react'

interface TickerItem {
  emoji: string
  text: string
}

interface Props {
  items: TickerItem[]
}

export default function ActivityTicker({ items }: Props) {
  // Hover/focus-pause alone fails touch users — there's no hover on a phone,
  // which is most of this app's traffic. WCAG 2.2.2 needs a mechanism that
  // doesn't depend on holding a pointer over the element, so this is an
  // explicit, always-visible toggle rather than relying on :hover alone.
  const [paused, setPaused] = useState(false)

  if (!items.length) return null

  const doubled = [...items, ...items]

  return (
    <div
      className="relative bg-amber-500 overflow-hidden py-2.5 select-none ticker-container"
      role="region"
      aria-label="Community activity"
    >
      {/* Visual ticker — hidden from screen readers (duplicated content is confusing) */}
      <div className={`flex whitespace-nowrap pr-10 ${paused ? '' : 'animate-ticker'}`} aria-hidden="true">
        {doubled.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 px-6 text-sm font-medium text-white shrink-0">
            <span>{item.emoji}</span>
            <span>{item.text}</span>
            <span className="mx-3 text-white/50">·</span>
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setPaused(p => !p)}
        aria-label={paused ? 'Resume scrolling activity ticker' : 'Pause scrolling activity ticker'}
        aria-pressed={paused}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/15 hover:bg-black/25 flex items-center justify-center text-white transition-colors"
      >
        {paused
          ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M8 5v14l11-7z" /></svg>
          : <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
        }
      </button>

      {/* Screen-reader list — unique items only */}
      <ul className="sr-only">
        {items.map((item, i) => (
          <li key={i}>{item.emoji} {item.text}</li>
        ))}
      </ul>
    </div>
  )
}
