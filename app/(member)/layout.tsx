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
    if (!isLoading && !isLoggedIn) router.replace(`/login?from=${encodeURIComponent(pathname)}`)
  }, [isLoading, isLoggedIn, pathname, router])

  if (isLoading || !isLoggedIn) return null

  return (
    <>
      {children}
      <PushPermission />
    </>
  )
}
