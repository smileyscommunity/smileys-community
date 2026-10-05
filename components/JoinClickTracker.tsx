'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics'

// One delegated listener for every "Join" / "Apply" link on the site, rather
// than an onClick edited into each of the dozens of buttons (navbar, footer,
// hero, city, event teaser, banners...). A new Apply link is counted without
// anyone remembering to wire it. `location` says which part of the page it
// sat in, so the funnel can compare a header Join with an event-page one.
// Capture only happens with analytics consent (posthog starts opted out).
function ctaLocation(a: Element): string {
  const tagged = a.closest('[data-cta]')?.getAttribute('data-cta')
  if (tagged) return tagged
  if (a.closest('footer')) return 'footer'
  if (a.closest('header, nav')) return 'header'
  return 'page'
}

export default function JoinClickTracker() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      let url: URL
      try { url = new URL(a.href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin || !/^\/app\/apply\/?$/.test(url.pathname)) return
      track('join_cta_click', {
        location: ctaLocation(a),
        from_path: window.location.pathname.replace(/^\/app/, '') || '/',
        target_city: url.searchParams.get('city'),
        label: (a.textContent ?? '').trim().slice(0, 40),
      })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  return null
}
