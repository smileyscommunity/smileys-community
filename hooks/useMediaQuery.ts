'use client'

import { useEffect, useState } from 'react'

// Whether a CSS media query currently matches, tracking changes (a tablet
// rotating, a window resized across the breakpoint).
//
// null until mounted: the server has no viewport, and guessing either way
// would start a fetch a hidden widget doesn't need, or skip one a visible
// widget does. Callers treat null as "not yet" and do nothing.
//
// For widgets the dashboard hides with `hidden lg:block`: CSS hiding still
// mounts them, so without this they fetched on every phone for a card nobody
// could see.
export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null)

  useEffect(() => {
    let mql: MediaQueryList
    try { mql = window.matchMedia(query) } catch { setMatches(false); return }
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])

  return matches
}

// Tailwind's `lg` — the breakpoint the dashboard's desktop-only rail uses.
export const LG_UP = '(min-width: 1024px)'
