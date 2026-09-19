'use client'

import { useEffect, useState, type RefObject } from 'react'

// Below md the bottom nav is fixed over the page, so nothing in the thread's
// own layout accounts for it. Same constant the admin and host shells reserve.
const BOTTOM_NAV = '4rem'
const MOBILE_MAX = 768

/**
 * How tall the thread may be, and a page that doesn't scroll underneath it.
 *
 * `calc(100dvh - 240px)` was a guess at everything stacked above the list —
 * navbar, thread header, composer — and the member pages can stack more than
 * that: verify-your-email, pending-approval and no-show banners all push the
 * composer off the bottom of the screen. 100dvh also ignores the software
 * keyboard, so on a phone the box you were typing in ended up under it.
 *
 * Measuring answers both. visualViewport is the part of the page actually
 * visible and shrinks when the keyboard opens, so the height is the distance
 * from this container's own top to the bottom of that — minus the bottom nav
 * on the phone layout, and its safe-area inset, which only CSS can resolve.
 *
 * Returns a CSS length for the container's `height`; inside it the list
 * scrolls and the composer stays put.
 */
export function useThreadViewport(ref: RefObject<HTMLElement | null>): string {
  // Until the first measurement lands (one frame), a full viewport is closer
  // to right than any guess at the chrome above.
  const [height, setHeight] = useState('100dvh')

  useEffect(() => {
    const vv = window.visualViewport

    function measure() {
      const node = ref.current
      if (!node) return
      const viewportH = vv?.height ?? window.innerHeight
      // getBoundingClientRect is relative to the layout viewport; offsetTop is
      // how far the visual viewport has been pushed down it (keyboard, pinch).
      const top   = node.getBoundingClientRect().top - (vv?.offsetTop ?? 0)
      const avail = Math.max(240, Math.round(viewportH - top))
      const nav   = window.innerWidth < MOBILE_MAX ? ` - ${BOTTOM_NAV} - env(safe-area-inset-bottom, 0px)` : ''
      setHeight(`calc(${avail}px${nav})`)
    }

    measure()
    window.addEventListener('resize', measure)
    vv?.addEventListener('resize', measure)
    vv?.addEventListener('scroll', measure)
    return () => {
      window.removeEventListener('resize', measure)
      vv?.removeEventListener('resize', measure)
      vv?.removeEventListener('scroll', measure)
    }
  }, [ref])

  // The thread owns the screen while it's open: with the page scrollable
  // behind it, a swipe on a phone moved the whole document instead of the
  // message list and left the composer somewhere above the fold.
  useEffect(() => {
    const html = document.documentElement
    const prevHtml = html.style.overflow
    const prevBody = document.body.style.overflow
    html.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtml
      document.body.style.overflow = prevBody
    }
  }, [])

  return height
}
