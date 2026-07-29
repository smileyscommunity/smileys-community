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
        >
          {/* Offset above the mobile bottom nav where it's actually showing
              (logged-in + an in-app route); elsewhere — notably the
              anonymous marketing homepage, the most likely first-visit
              page — there's no bar to clear, so don't bury more of the
              page under empty space. Flush (mb-0) on desktop either way. */}
          <div className={`${clearsBottomNav ? 'mb-16' : 'mb-3'} md:mb-0 mx-3 md:mx-0`}>
            <div className="md:max-w-2xl md:mx-auto md:mb-6 bg-gray-900 text-white rounded-2xl shadow-2xl px-4 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed text-gray-200">
                  We use essential cookies to keep you signed in, and optional analytics cookies to improve the experience.{' '}
                  <Link href="/cookies" className="underline underline-offset-2 text-amber-400 hover:text-amber-300 transition-colors whitespace-nowrap">
                    Cookie policy
                  </Link>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={decline}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  Essential only
                </button>
                <button
                  onClick={accept}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold transition-colors"
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
