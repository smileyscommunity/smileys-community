'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Dismissible "what's new in Smileys" card. Renders once on the dashboard for
// members who haven't dismissed it yet. localStorage-backed so the dismiss
// state is per-browser — fine for an informational card, no schema cost.
// Bump the suffix to v2 etc. to re-show after a future feature drop. Bumped
// to v2 when Smileys Cup 2026 was added — previous dismissers see the
// refreshed list once so the new item gets discovery; if they dismiss again
// the v2 flag silences it.
const DISMISS_KEY = 'smileys_onboarding_v2'

interface Item {
  emoji:       string
  title:       string
  description: string
  href:        string
}

const ITEMS: Item[] = [
  {
    emoji:       '⚽',
    title:       'Smileys World Cup 2026',
    description: 'Predict every match. Trophy + prizes for the winner. Free to play.',
    href:        '/cup',
  },
  {
    emoji:       '☕',
    title:       'Hangouts',
    description: '"I\'m at this café for 2hrs — anyone want to join?"',
    href:        '/hangouts',
  },
  {
    emoji:       '👋',
    title:       'Visiting?',
    description: 'See who\'s coming to Istanbul this month, or post your own trip.',
    href:        '/visiting',
  },
  {
    emoji:       '🟢',
    title:       'Open to coffee?',
    description: 'Toggle "Open to…" in Settings so newcomers know you\'re up for an intro.',
    href:        '/settings',
  },
  {
    emoji:       '🗺️',
    title:       'Istanbul Guide',
    description: 'Visa, healthcare, banking, mobile — the basics for new arrivals.',
    href:        '/guide',
  },
]

export default function OnboardingCard() {
  // Start hidden to avoid an SSR/CSR flash; flip to true on mount if not dismissed.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) !== '1') setVisible(true)
    } catch {
      // localStorage unavailable (private window, etc.) — just don't show.
    }
  }, [])

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm relative">
      <button
        onClick={dismiss}
        className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-amber-500 hover:text-amber-700 hover:bg-amber-100 transition-colors text-lg leading-none"
        title="Dismiss"
        aria-label="Dismiss onboarding card"
      >
        ×
      </button>

      <p className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-1">New in Smileys</p>
      <h3 className="text-base font-extrabold text-gray-900 mb-3">What&apos;s here this week</h3>

      <div className="space-y-2">
        {ITEMS.map(it => (
          <Link
            key={it.href}
            href={it.href}
            className="flex items-start gap-2.5 p-2 -mx-2 rounded-xl hover:bg-amber-100/60 transition-colors group"
          >
            <span className="text-lg shrink-0 leading-none mt-0.5">{it.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 group-hover:text-amber-700 transition-colors">{it.title}</p>
              <p className="text-xs text-gray-600 leading-snug">{it.description}</p>
            </div>
            <span className="text-amber-500 shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          </Link>
        ))}
      </div>

      <button
        onClick={dismiss}
        className="mt-3 w-full text-xs font-semibold text-amber-700 hover:text-amber-900 py-2 transition-colors"
      >
        Got it — hide this
      </button>
    </div>
  )
}
