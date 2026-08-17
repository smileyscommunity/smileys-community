'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import PushPermission from '@/components/PushPermission'

export default function AppLayout({ children }: { children: ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const { isLoggedIn, isLoading } = useAuth()

  useEffect(() => {
    // `from` lets /login explain *why* the visitor landed there instead of
    // silently dropping them on a bare sign-in form — several nav links
    // (Members, World Cup, Visiting?) are shown to logged-out users but
    // point at member-only routes gated by this layout.
    // The query string has to come along: /login now navigates back to `from`
    // after signing in, and /visiting/new?city=izmir without its ?city
    // silently defaults to the home city — a wrong-city post, not a missing
    // one. Read it off window rather than useSearchParams so this layout
    // stays out of the Suspense contract (same trade as hangouts/page.tsx).
    if (!isLoading && !isLoggedIn) {
      const search = typeof window === 'undefined' ? '' : window.location.search
      router.replace(`/login?from=${encodeURIComponent(pathname + search)}`)
    }
  }, [isLoading, isLoggedIn, pathname, router])

  if (isLoading || !isLoggedIn) return null

  return (
    <>
      {children}
      <PushPermission />
    </>
  )
}
