'use client'

import { useEffect, useState } from 'react'

interface NavItem {
  id: string
  icon: string
  label: string
}

// Scrollspy island for the sticky quick-jump nav. Server-rendered
// version was inert — pills only worked as click-to-jump anchors,
// with no indication of which section the user was currently
// reading. IntersectionObserver tracks which section's top has
// crossed into the upper band of the viewport (just below the
// sticky nav) and the matching pill flips to an active style
// (filled amber + bold + aria-current). Auto-scroll of the
// horizontal pill row is deliberately omitted — if a user is
// scrolling vertically, having the nav lurch sideways on its own
// reads as buggy.
export default function GuideStickyNav({ navItems }: { navItems: NavItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (navItems.length === 0) return
    const sections = navItems
      .map(n => document.getElementById(n.id))
      .filter((el): el is HTMLElement => !!el)
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      entries => {
        const intersecting = entries.filter(e => e.isIntersecting)
        if (intersecting.length === 0) return
        // Pick the topmost section in the trigger zone — when two
        // sections straddle the band, the one whose top is highest
        // (i.e., the one the user is currently reading toward) wins.
        const top = intersecting
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        setActiveId(top.target.id)
      },
      // Trigger band: ~80px from the top (clears the sticky nav)
      // down to 40% of the viewport. A section is "active" while
      // its top sits inside that upper band.
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    )
    sections.forEach(s => observer.observe(s))
    return () => observer.disconnect()
  }, [navItems])

  return (
    /* relative on the outer bar so the right-edge fade sits at the
       VIEWPORT edge, not at the centered max-w-7xl inner edge.
       On wide screens the previous setup left the fade as a small
       smudge floating in the middle of the bar; now the fade bleeds
       off the visible bar edge like a true affordance.
       max-w-7xl + lg:px-8 matches the hero and content sections below —
       max-w-4xl left this row narrower than its siblings, so it didn't
       start at the same left edge as the page title on wide screens. */
    <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-gray-100 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav aria-label="Guide sections" className="flex flex-wrap gap-1.5 py-2">
          {navItems.map(item => {
            const isActive = item.id === activeId
            return (
              <a key={item.id} href={`#${item.id}`}
                aria-current={isActive ? 'true' : undefined}
                /* min-h-11 (44px) so the touch area meets WCAG 2.2 AAA
                   target-size; visual padding stays small via py-1.5
                   so the bar doesn't look chunky. */
                className={`shrink-0 flex items-center gap-1.5 min-h-11 px-3 py-1.5 rounded-full text-xs border transition-colors whitespace-nowrap ${
                  isActive
                    ? 'font-bold text-amber-800 bg-amber-100 border-amber-300'
                    : 'font-semibold text-gray-600 hover:text-amber-700 hover:bg-amber-50 border-gray-200 hover:border-amber-200'
                }`}>
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </a>
            )
          })}
        </nav>
      </div>
      {/* Right-edge fade — signals horizontal scroll when more pills
          sit off-screen. Sits at the outer bar level so it bleeds off
          the bar's right edge on wide screens. pointer-events-none so
          clicks still hit the rightmost pill underneath. */}
      <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white/95 to-transparent" />
    </div>
  )
}
