'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { readConsent } from '@/lib/consent'
import { track } from '@/lib/analytics'
import { joinBarAllowed, JOIN_BAR_SCROLL_FALLBACK_PX } from '@/lib/joinBar'

// A quiet "Join Smileys" bar for long public pages on a phone: the hero CTA is
// gone by the time a reader has scrolled through a guide, and the navbar's
// Join is small. Guests only, only once the hero CTA (an element marked
// data-join-hero, optionally data-join-city) has scrolled off the TOP of the
// screen — or, on a page without one, after JOIN_BAR_SCROLL_FALLBACK_PX. It
// waits for the cookie banner to be answered rather than stacking on it, can be
// dismissed for the session, and sits above the home-indicator inset. Hidden on
// md+ where the header stays in view. Counted through join_cta_click
// (data-cta="sticky-bar") plus shown/dismissed, so its effect is measurable.
const DISMISS_KEY = 'smileys-join-bar-dismissed'

function readDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

export default function JoinStickyBar() {
  const pathname = usePathname()
  // The string, not the useSearchParams() object: that is a new object every
  // render, which would tear down and re-attach the scroll observer each time.
  const cityParam = useSearchParams().get('city')
  const { isLoggedIn, isLoading } = useAuth()
  const [pastHero, setPastHero] = useState(false)
  const [answered, setAnswered] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [city, setCity] = useState<string | null>(null)

  const eligible = !isLoading && !isLoggedIn && joinBarAllowed(pathname) && !dismissed

  useEffect(() => { setDismissed(readDismissed()) }, [])

  // Cookie banner first: both are fixed to the bottom edge.
  useEffect(() => {
    setAnswered(readConsent() !== null)
    const on = () => setAnswered(true)
    window.addEventListener('smileys:consent', on)
    return () => window.removeEventListener('smileys:consent', on)
  }, [])

  useEffect(() => {
    setPastHero(false)
    if (!eligible) return
    const hero = document.querySelector('[data-join-hero]')
    setCity(hero?.getAttribute('data-join-city') ?? cityParam)
    if (hero) {
      const io = new IntersectionObserver(([e]) => setPastHero(!e.isIntersecting && e.boundingClientRect.bottom < 0))
      io.observe(hero)
      return () => io.disconnect()
    }
    const onScroll = () => setPastHero(window.scrollY > JOIN_BAR_SCROLL_FALLBACK_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [eligible, pathname, cityParam])

  const show = eligible && pastHero && answered

  // Room for the bar so it never covers the last of the page (the footer).
  useEffect(() => {
    document.documentElement.classList.toggle('has-join-bar', show)
    return () => document.documentElement.classList.remove('has-join-bar')
  }, [show])

  useEffect(() => {
    if (show) track('join_bar_shown', { from_path: pathname })
  }, [show, pathname])

  if (!show) return null

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode: dismissed for this view only */ }
    setDismissed(true)
    track('join_bar_dismissed', { from_path: pathname })
  }

  return (
    <div
      role="region" aria-label="Join Smileys" data-cta="sticky-bar"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)] motion-safe:animate-[joinbar-in_0.25s_ease-out]"
    >
      <div className="flex items-center gap-2 pl-4 pr-1 py-2">
        <p className="flex-1 min-w-0 text-xs text-gray-600 leading-snug">
          Free to apply · reviewed by hand
        </p>
        <Link
          href={city ? `/apply?city=${encodeURIComponent(city)}` : '/apply'}
          className="shrink-0 px-5 py-2 min-h-[44px] inline-flex items-center rounded-xl bg-amber-500 text-white text-sm font-semibold"
        >
          Join Smileys
        </Link>
        <button
          type="button" onClick={dismiss} aria-label="Dismiss"
          className="shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
