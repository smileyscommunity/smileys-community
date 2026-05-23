'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

export default function PendingStatusPage() {
  const { user, isLoggedIn, isLoading, logout } = useAuth()
  const router = useRouter()
  const [status, setStatus] = useState<string | null>(null)
  const [email,  setEmail]  = useState('')

  useEffect(() => {
    if (isLoading) return
    if (!isLoggedIn) { router.replace('/login'); return }
    fetch('/app/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setStatus(d?.status ?? null)
        setEmail(d?.email ?? '')
        // Already approved — send to app
        if (d?.status === 'approved') router.replace('/dashboard')
      })
  }, [isLoggedIn, isLoading, router])

  if (isLoading || !isLoggedIn || !status) return null

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-white rounded-2xl shadow-card p-8">
          <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6 text-4xl">
            ⏳
          </div>

          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">Application under review</h1>
          <p className="text-gray-500 mb-6">
            Hi <strong>{user.name.split(' ')[0]}</strong> — we've received your application and will review it personally.
            You'll get an email at <strong className="text-gray-700">{email}</strong> once you're approved.
          </p>

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-left space-y-3 mb-6">
            <div className="flex items-start gap-3">
              <span className="text-amber-500 mt-0.5">✓</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">Application submitted</p>
                <p className="text-xs text-gray-500">We have your details</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-amber-500 mt-0.5">⋯</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">Under review</p>
                <p className="text-xs text-gray-500">Usually within 24–48 hours</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-gray-300 mt-0.5">○</span>
              <div>
                <p className="text-sm font-semibold text-gray-400">Approved — you're in!</p>
                <p className="text-xs text-gray-400">Full access to events and clubs</p>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-400 mb-6">
            While you wait, you can browse upcoming events and get a feel for the community.
          </p>

          <div className="space-y-2">
            <Link href="/events" className="block w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors">
              Browse events
            </Link>
            <button onClick={logout} className="block w-full py-3 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 text-sm transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
