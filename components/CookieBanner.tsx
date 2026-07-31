'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/contexts/AuthContext'
import { isBottomNavRoute } from '@/lib/bottomNav'

const STORAGE_KEY = 'smileys-cookie-consent'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)
  const { isLoggedIn } = useAuth()
  const pathname = usePathname()
  // BottomNav only renders for logged-in users on these routes — anywhere
  // else (notably the anonymous marketing homepage, where this banner is
  // most likely to be the first thing a new visitor sees) there's no bar to
  // clear, so reserving 64px under the banner just buries more of the page.
  const clearsBottomNav = isLoggedIn && isBottomNavRoute(pathname)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    } catch {}
  }, [])

  function accept() {
    try { localStorage.setItem(STORAGE_KEY, 'accepted') } catch {}
    setVisible(false)
  }

  function decline() {
    try { localStorage.setItem(STORAGE_KEY, 'essential') } catch {}
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0,   opacity: 1 }}
          exit={{    y: 100, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-0 left-0 right-0 z-[60] pb-[env(safe-area-inset-bottom)]"
          role="region"
          aria-label="Cookie consent"
        >
          {/* Offset above the mobile bottom nav where it's actually showing
              (logged-in + an in-app route); elsewhere — notably the
              anonymous marketing homepage, the most likely first-visit
              page — there's no bar to clear. Flush (mb-0) on desktop either way. */}
          <div className={clearsBottomNav ? 'mb-16 md:mb-0' : 'md:mb-0'}>
            {/* Mobile: a flush, edge-to-edge bar — no side margin, no
                rounding, single row (text truncates, buttons never do).
                Desktop: the previous floating card, where screen space
                isn't scarce and stacking was never the issue. */}
            <div className="md:max-w-2xl md:mx-auto md:mb-6 bg-gray-900 text-white md:rounded-2xl shadow-lg md:shadow-2xl px-4 py-2.5 md:px-5 md:py-4 flex items-center gap-3">
              <div className="flex-1 min-w-0 flex items-center gap-1.5 text-xs md:text-sm text-gray-200">
                <span className="truncate">We use cookies to keep you signed in and improve your experience.</span>
                <Link href="/cookies" className="shrink-0 underline underline-offset-2 text-amber-400 hover:text-amber-300 transition-colors">
                  Details
                </Link>
              </div>
              <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
                {/* Visual pill stays slim (this is what keeps the bar
                    ~48px tall) but the tappable area is expanded to 44px
                    via an invisible ::before overlay — width already clears
                    44px so only height needs the hit-area boost. */}
                <button
                  onClick={decline}
                  className="relative px-2.5 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10 transition-colors before:absolute before:content-[''] before:inset-x-0 before:-inset-y-2.5 md:before:inset-0"
                >
                  Essential only
                </button>
                <button
                  onClick={accept}
                  className="relative px-2.5 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs md:text-sm font-semibold transition-colors before:absolute before:content-[''] before:inset-x-0 before:-inset-y-2.5 md:before:inset-0"
                >
                  Accept all
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
