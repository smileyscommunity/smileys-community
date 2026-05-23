'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

export default function PendingApprovalBanner() {
  const { isLoggedIn } = useAuth()
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setStatus(d?.status ?? null))
      .catch(() => {})
  }, [isLoggedIn])

  if (!isLoggedIn || status !== 'pending') return null

  return (
    <div className="bg-amber-500 text-white text-sm font-medium px-4 py-2.5 text-center flex items-center justify-center gap-3 flex-wrap">
      <span>⏳ Your membership application is under review.</span>
      <Link href="/pending" className="underline font-bold hover:text-amber-100 transition-colors whitespace-nowrap">
        Check status →
      </Link>
    </div>
  )
}
