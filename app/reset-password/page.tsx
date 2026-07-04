'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import PasswordToggle from '@/components/PasswordToggle'

function ResetPasswordForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const token      = searchParams.get('token')    ?? ''
  const isActivate = searchParams.get('activate') === '1'

  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [done,     setDone]     = useState(false)

  useEffect(() => {
    if (!token) setError('Invalid reset link.')
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      const res  = await fetch('/app/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
      setDone(true)
      setTimeout(() => router.push(isActivate ? '/login' : '/login'), 2000)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="text-center mb-8">
        <Link href="/" className="inline-flex items-center gap-2 mb-6">
          <span className="text-3xl">😊</span>
          <span className="font-bold text-xl text-gray-900">Smileys Community</span>
        </Link>
        <h1 className="text-2xl font-extrabold text-gray-900">{isActivate ? 'Activate your account' : 'Reset your password'}</h1>
        <p className="text-sm text-gray-600 mt-1">{isActivate ? "One last step — choose a password and you're in" : 'Choose a new password for your account'}</p>
      </div>
      <div className="bg-white rounded-2xl shadow-card p-7">
      {done ? (
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-green-700 bg-green-50 border border-green-100 px-4 py-3 rounded-xl text-sm font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {isActivate ? 'Account activated! Redirecting to sign in…' : 'Password updated! Redirecting to sign in…'}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
          )}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">{isActivate ? 'Choose a password' : 'New password'}</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                className="input pr-12"
              />
              <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Confirm new password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                required
                className="input pr-12"
              />
              <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !token}
            className="btn-primary w-full text-sm"
          >
            {loading ? 'Saving…' : isActivate ? 'Activate my account →' : 'Set new password'}
          </button>
          <p className="text-center text-sm text-gray-600">
            <Link href="/login" className="text-amber-600 font-semibold hover:underline">Back to sign in</Link>
          </p>
        </form>
      )}
      </div>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}
