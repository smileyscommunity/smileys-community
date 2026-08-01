'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { isBottomNavRoute } from '@/lib/bottomNav'

// Mobile-only sticky CTA. Three things decide whether it's on screen, and
// all three matter:
//
//  - md:hidden — desktop has the hero and closing CTAs comfortably in view;
//    a floating bar there is just clutter.
//  - Scrolled past the hero. While the hero's own "Tell Us You're Coming"
//    button is still visible this would be a second copy of the same button
//    a few hundred pixels below the first.
//  - Not already posted. Someone whose visit is live has already done the
//    one thing this asks for; nagging them is worse than showing nothing.
//
// Bottom offset reuses BottomNav's own visibility rule (logged-in + an
// in-app route) via the shared BOTTOM_NAV_ROUTES list, the same way
// CookieBanner does — hardcoding "always clear 64px" would float this bar
// above nothing for logged-out visitors, who are most of this page's
// audience. z-40 keeps it under both the nav (z-50) and the cookie banner
// (z-60), so neither is ever blocked by it.
export default function StickyVisitCta({ hasPosted }: { hasPosted: boolean }) {
  const { isLoggedIn } = useAuth()
  const pathname       = usePathname()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    // Threshold sits just under the 500px mobile hero so the bar appears as
    // the hero button leaves, not before it.
    const onScroll = () => setScrolled(window.scrollY > 450)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (hasPosted || !scrolled) return null

  const clearsBottomNav = isLoggedIn && isBottomNavRoute(pathname)

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-40 md:hidden pb-[env(safe-area-inset-bottom)] ${clearsBottomNav ? 'mb-16' : ''}`}>
      <div className="bg-white/95 backdrop-blur-md border-t border-gray-200 px-4 py-3">
        <Link href={isLoggedIn ? '/visiting/new' : '/apply'}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold rounded-xl transition-colors shadow-sm">
          Tell Us You&apos;re Coming
          <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
