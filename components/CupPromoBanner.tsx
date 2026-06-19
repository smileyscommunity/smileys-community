'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// Compact promo pill for Smileys Cup 2026. Lives in the dashboard
// welcome column, right after the member's name (and beside the
// "Next: <event>" pill when there's an upcoming RSVP). White on
// amber-gradient hero so it pops without taking its own row —
// the previous full-width card iteration ate vertical space that
// pushed every other widget below the fold on mobile.
//
// Dismissible per-browser via localStorage. Also auto-hides after
// the tournament wraps (final match Jul 19, 2026) so the
// dashboard cleans itself up without a code change.
//
// Bumping DISMISS_KEY (v1 → v2 etc.) re-shows the pill to members
// who previously dismissed — handy if we run a follow-up campaign
// on this surface.

const DISMISS_KEY    = 'smileys_cup_promo_v1'
// Final match kicks off Jul 19, 2026 ~22:00 Istanbul. Hide the
// pill from the next day onwards regardless of dismiss state.
const TOURNAMENT_END = Date.parse('2026-07-20T00:00:00+03:00')

export default function CupPromoBanner() {
  // Start hidden to avoid an SSR/CSR flash. Flip on mount if (a)
  // the tournament hasn't ended AND (b) the dismiss flag isn't set.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (Date.now() > TOURNAMENT_END) return
    try {
      if (localStorage.getItem(DISMISS_KEY) !== '1') setVisible(true)
    } catch {
      // localStorage unavailable (private window, etc.) — show
      // anyway. The campaign promo is the more important signal.
      setVisible(true)
    }
  }, [])

  function dismiss(e: React.MouseEvent) {
    // Stop the click bubbling into the Link so dismiss doesn't
    // double-fire a navigation to /cup.
    e.preventDefault()
    e.stopPropagation()
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    // mt-3 matches the "Next: <event>" pill above it (when both
    // are present, they sit on the same row separated by a JSX
    // whitespace and wrap to two rows on narrow viewports).
    // align-middle keeps the inline pill + × button aligned with
    // the nextEvent pill baseline.
    <div className="mt-3 inline-flex items-center gap-1.5 align-middle">
      <Link href="/cup"
        className="inline-flex items-center gap-2 bg-white text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded-full text-xs font-bold shadow-md transition-all group">
        <span aria-hidden className="text-sm leading-none transform group-hover:scale-110 transition-transform">⚽</span>
        <span className="leading-none">Play Smileys World Cup 2026</span>
        <span className="text-amber-500 leading-none group-hover:translate-x-0.5 transition-transform">→</span>
      </Link>
      {/* Dismiss × — small but ≥24px tap target via the w-6 h-6
          container (24px on the cross axis, comfortable for thumbs).
          Soft amber so it reads as part of the hero chrome on the
          subtle amber wash rather than a button "on" the pill. */}
      <button
        onClick={dismiss}
        className="w-6 h-6 rounded-full flex items-center justify-center text-amber-600/70 hover:text-amber-800 hover:bg-amber-100 transition-colors text-sm leading-none"
        title="Dismiss"
        aria-label="Dismiss cup banner"
      >
        ×
      </button>
    </div>
  )
}
