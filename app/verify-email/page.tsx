'use client'

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token        = searchParams.get('token') ?? ''
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error,  setError]  = useState('')

  useEffect(() => {
    if (!token) { setStatus('error'); setError('Invalid verification link.'); return }

    fetch('/app/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) setStatus('success')
        else { setStatus('error'); setError(data.error ?? 'Verification failed') }
      })
      .catch(() => { setStatus('error'); setError('Something went wrong') })
  }, [token])

  return (
    <div className="bg-white rounded-2xl shadow-card p-8 text-center space-y-4">
      {status === 'loading' && (
        <>
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-600">Verifying your email…</p>
        </>
      )}
      {status === 'success' && (
        <>
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900">Email verified!</h2>
          <p className="text-sm text-gray-600">Your account is now fully active.</p>
          <Link href="/dashboard" className="inline-block px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
            Go to dashboard
          </Link>
        </>
      )}
      {status === 'error' && (
        <>
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900">Verification failed</h2>
          <p className="text-sm text-gray-600">{error}</p>
          <Link href="/login" className="inline-block text-sm text-amber-600 font-semibold hover:underline">
            Back to sign in
          </Link>
        </>
      )}
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <span className="text-3xl">😊</span>
            <span className="font-bold text-xl text-gray-900">Smileys Community</span>
          </Link>
          <h1 className="text-2xl font-extrabold text-gray-900">Email verification</h1>
        </div>
        <Suspense>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  )
}
