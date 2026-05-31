'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// Dashboard hero banner promoting the Smileys Cup 2026 prediction
// game. Lives INSIDE the amber/orange gradient hero on /dashboard
// — fills the previously-empty space below the quick-stats strip
// with a high-contrast white card so the campaign is the first
// thing a member sees on login during the tournament window.
//
// Dismissible per-browser via localStorage. Also auto-hides post-
// tournament (final match Jul 19, 2026) so the dashboard cleans
// itself up without needing a code change.
//
// Bumping DISMISS_KEY (v1 → v2 etc.) re-shows the banner to
// members who previously dismissed — handy if we run a follow-up
// campaign on the same surface.

const DISMISS_KEY    = 'smileys_cup_promo_v1'
// Final match kicks off Jul 19, 2026 ~22:00 Istanbul. Hide the
// banner from the next day onwards regardless of dismiss state.
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
    // Stop the click bubbling into the Link so the dismiss button
    // doesn't double-fire a navigation to /cup.
    e.preventDefault()
    e.stopPropagation()
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="mt-4 relative">
      <Link href="/cup"
        className="flex items-center gap-3 bg-white/95 backdrop-blur-sm hover:bg-white rounded-2xl p-3 sm:p-4 shadow-lg group transition-all">
        {/* Ball emoji as the visual anchor — keeps the "this is a
            football tournament" signal without implying a literal
            trophy prize (prizes are sponsor-donated; see /cup
            Prizes section). Scale-on-hover gives the card
            tactility without an animation library. */}
        <span className="text-3xl shrink-0 transform group-hover:scale-110 transition-transform" aria-hidden>⚽</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 leading-none mb-1">
            New · Free to play
          </p>
          <p className="text-sm sm:text-base font-extrabold text-gray-900 leading-tight truncate">
            Smileys World Cup 2026
          </p>
          <p className="text-[11px] sm:text-xs text-gray-500 leading-snug mt-0.5 truncate">
            Predict every match · Win prizes · Bracket locks Jun 11
          </p>
        </div>
        {/* Play pill — full button label on sm+, just an arrow on
            the tightest phones so the row never wraps. */}
        <span className="bg-amber-500 text-white text-xs font-bold px-3 py-2 rounded-xl shrink-0 group-hover:bg-amber-600 transition-colors hidden sm:inline-flex items-center">
          Play →
        </span>
        <span className="bg-amber-500 text-white text-base font-bold w-9 h-9 rounded-xl shrink-0 group-hover:bg-amber-600 transition-colors inline-flex items-center justify-center sm:hidden" aria-label="Play">
          →
        </span>
      </Link>
      {/* Dismiss × — absolutely positioned so it sits over the card's
          top-right corner without affecting the Link's flex layout.
          z-10 lifts it above the Link's hit area. */}
      <button
        onClick={dismiss}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-base leading-none z-10"
        title="Dismiss"
        aria-label="Dismiss cup banner"
      >
        ×
      </button>
    </div>
  )
}
