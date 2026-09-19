'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { usePathname } from 'next/navigation'

export default function PendingApprovalBanner() {
  const { isLoggedIn } = useAuth()
  const [status, setStatus] = useState<string | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setStatus(d?.status ?? null))
      .catch(() => {})
  }, [isLoggedIn])

  // Not over the admin and host panels, which fill the screen themselves.
  const onPanel = pathname?.startsWith('/admin') || pathname === '/host' || pathname?.startsWith('/host/')
  if (!isLoggedIn || status !== 'pending' || onPanel) return null

  return (
    <div className="bg-amber-500 text-white text-sm font-medium px-4 py-2.5 text-center flex items-center justify-center gap-3 flex-wrap" role="region" aria-label="Application status">
      <span>⏳ Your membership application is under review.</span>
      <Link href="/pending" className="underline font-bold hover:text-amber-100 transition-colors whitespace-nowrap">
        Check status →
      </Link>
    </div>
  )
}
