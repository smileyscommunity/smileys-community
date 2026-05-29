'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Turnstile from '@/components/Turnstile'
import { useAuth } from '@/contexts/AuthContext'
import type { AppUser } from '@/lib/auth'
import posthog from 'posthog-js'
// Same FingerprintJS library the apply form uses — collects a stable
// visitorId so the login endpoint can stamp User.lastFingerprint, giving
// admins the cross-account match signal ("is this banned user back?").
import FingerprintJS from '@fingerprintjs/fingerprintjs'

export default function LoginPage() {
  const router = useRouter()
  const { setUser } = useAuth()

  const [email,         setEmail]         = useState('')
  const [password,      setPassword]      = useState('')
  const [error,         setError]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [show,          setShow]          = useState(false)
  const [resendSent,     setResendSent]     = useState(false)
  const [resendLoading,  setResendLoading]  = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [step,          setStep]          = useState<'credentials' | '2fa'>('credentials')
  const [totpCode,      setTotpCode]      = useState('')
  const [fingerprint,   setFingerprint]   = useState('')

  useEffect(() => {
    // Async load — runs while user is typing credentials. If it hasn't
    // resolved by submit time, login still proceeds without _fp (admin
    // tooling tolerates null).
    FingerprintJS.load().then(fp => fp.get()).then(r => setFingerprint(r.visitorId)).catch(() => {})
  }, [])

  const needsVerification  = error.includes('verify your email')
  const isSuspended        = error.includes('suspended')
  const turnstileRequired  = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  async function handleResend() {
    setResendLoading(true)
    await fetch('/app/api/auth/resend-verification', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setResendSent(true)
    setResendLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/app/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, _cf: turnstileToken, _fp: fingerprint || undefined }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        return
      }

      if (data.requires2FA) {
        setStep('2fa')
        return
      }

      finishLogin(data)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handle2FA(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/app/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode.replace(/\s/g, '') }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Invalid code')
        return
      }

      finishLogin(data)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  function finishLogin(data: AppUser & { requires2FA?: boolean }) {
    setUser({
      id:            data.id,
      name:          data.name,
      initials:      data.initials,
      color:         data.color,
      role:          data.role,
      bio:           data.bio,
      neighborhood:  data.neighborhood,
      instagram:     data.instagram,
      isClubHost:    data.isClubHost,
      emailVerified: data.emailVerified,
    })

    // Staff dogfooding shouldn't pollute member funnels — opt them out entirely
    // (skips identify + autocaptures + the user_signed_in event below).
    if (data.role === 'admin' || data.role === 'moderator') {
      posthog.opt_out_capturing()
    } else {
      // Re-enable in case the previous session on this browser was staff.
      posthog.opt_in_capturing()
      // Keep person properties PII-light; we already store name/email/etc. in our DB
      // and can join on distinctId when we need them.
      posthog.identify(data.id, {
        role:         data.role,
        neighborhood: data.neighborhood,
        is_club_host: data.isClubHost,
      })
      posthog.capture('user_signed_in', {
        role:         data.role,
        is_club_host: data.isClubHost,
      })
    }

    if (data.role === 'admin') router.push('/admin')
    else if (data.isClubHost) router.push('/host')
    else router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <span className="text-3xl">😊</span>
            <span className="font-bold text-xl text-gray-900">Smileys Community</span>
          </Link>
          <h1 className="text-2xl font-extrabold text-gray-900">
            {step === '2fa' ? 'Two-factor authentication' : 'Welcome back'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {step === '2fa'
              ? 'Enter the 6-digit code from your authenticator app'
              : 'Sign in to your account'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-card p-7">
          {step === 'credentials' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                  {error}
                  {needsVerification && (
                    <div className="mt-2">
                      {resendSent ? (
                        <span className="text-green-700 text-xs font-medium">✓ Verification email sent — check your inbox</span>
                      ) : (
                        <button onClick={handleResend} disabled={resendLoading}
                          className="text-xs font-semibold text-amber-700 hover:underline disabled:opacity-50">
                          {resendLoading ? 'Sending…' : 'Resend verification email →'}
                        </button>
                      )}
                    </div>
                  )}
                  {isSuspended && (
                    <div className="mt-2">
                      <Link href="/appeal" className="text-xs font-semibold text-red-700 hover:underline">
                        Appeal your suspension →
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
                <input
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

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-semibold text-gray-700">Password</label>
                  <Link href="/forgot-password" className="text-xs text-amber-600 hover:underline font-medium">Forgot password?</Link>
                </div>
                <div className="relative">
                  <input
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                    className="input pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium"
                  >
                    {show ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} />
              {turnstileRequired && !turnstileToken && !loading && (
                <p className="text-center text-xs text-gray-400">Complete the verification above to continue</p>
              )}
              <button
                type="submit"
                disabled={loading || (turnstileRequired && !turnstileToken)}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 text-sm"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form onSubmit={handle2FA} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                  {error}
                </div>
              )}

              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center">
                  <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5 text-center">Authenticator code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  required
                  className="input text-center tracking-[0.5em] font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 text-sm"
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>

              <button
                type="button"
                onClick={() => { setStep('credentials'); setError(''); setTotpCode('') }}
                className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                ← Back to login
              </button>
            </form>
          )}

          {step === 'credentials' && (
            <p className="text-center text-sm text-gray-500 mt-5">
              Don't have an account?{' '}
              <Link href="/apply" className="text-amber-600 font-semibold hover:underline">
                Apply to join
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
