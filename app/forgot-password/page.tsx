'use client'

import { useState } from 'react'
import Link from 'next/link'
import Turnstile from '@/components/Turnstile'

export default function ForgotPasswordPage() {
  const [email,          setEmail]          = useState('')
  const [loading,        setLoading]        = useState(false)
  const [sent,           setSent]           = useState(false)
  const [error,          setError]          = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  // Bumped after a failed submit — Turnstile tokens are single-use, so retries need a fresh one
  const [turnstileReset, setTurnstileReset] = useState(0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/app/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, _cf: turnstileToken }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        setTurnstileToken('')
        setTurnstileReset(n => n + 1)
        return
      }
      setSent(true)
    } catch {
      setError('Something went wrong. Try again.')
      setTurnstileToken('')
      setTurnstileReset(n => n + 1)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <span className="text-3xl">😊</span>
            <span className="font-bold text-xl text-gray-900">Smileys Community</span>
          </Link>
          <h1 className="text-2xl font-extrabold text-gray-900">Reset your password</h1>
          <p className="text-sm text-gray-600 mt-1">Enter your email and we'll send a reset link</p>
        </div>

        <div className="bg-white rounded-2xl shadow-card p-7">
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="flex items-center justify-center gap-2 text-green-700 bg-green-50 border border-green-100 px-4 py-3 rounded-xl text-sm font-medium">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Check your email
              </div>
              <p className="text-sm text-gray-600">
                If an account exists for <strong className="text-gray-800 break-all">{email}</strong>, we sent a reset link. Check your inbox (and spam folder). The link expires in 1 hour.
              </p>
              <button
                onClick={() => { setSent(false); setError('') }}
                className="block w-full text-sm text-gray-600 hover:text-gray-700"
              >
                Wrong email? <span className="text-amber-600 font-semibold">Try again</span>
              </button>
              <Link href="/login" className="block text-sm text-amber-600 font-semibold hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
              )}
              <div>
                <label htmlFor="fp-email" className="block text-sm font-semibold text-gray-700 mb-1.5">Email address</label>
                <input
                  id="fp-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  className="input"
                />
              </div>
              <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} resetSignal={turnstileReset} />
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full text-sm"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
              <p className="text-center text-sm text-gray-600">
                <Link href="/login" className="text-amber-600 font-semibold hover:underline">Back to sign in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
