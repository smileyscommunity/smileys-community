'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

export default function VerifyEmailBanner() {
  const { user, isLoggedIn } = useAuth()
  const [sent,    setSent]    = useState(false)
  const [loading, setLoading] = useState(false)

  if (!isLoggedIn || user.emailVerified || user.role === 'admin' || user.role === 'moderator' || user.isClubHost) return null

  async function resend() {
    setLoading(true)
    try {
      await fetch('/app/api/auth/resend-verification', { method: 'POST' })
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200" role="region" aria-label="Email verification">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
        <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
        </svg>
        <p className="text-sm text-amber-800 flex-1">
          <strong>Please verify your email</strong> — check your inbox for a link from Smileys.
        </p>
        {sent ? (
          <span className="text-xs text-green-700 font-medium bg-green-100 px-3 py-1 rounded-full">Email sent ✓</span>
        ) : (
          <button onClick={resend} disabled={loading}
            className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline disabled:opacity-50">
            {loading ? 'Sending…' : 'Resend email'}
          </button>
        )}
      </div>
    </div>
  )
}
