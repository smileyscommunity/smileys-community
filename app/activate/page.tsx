'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'
import PasswordToggle from '@/components/PasswordToggle'

interface UserInfo {
  name: string
  email: string
  interests: string[]
  profilePhoto: string | null
}

function ActivateForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const token        = searchParams.get('token') ?? ''
  const { setUser }  = useAuth()

  const [info,     setInfo]     = useState<UserInfo | null>(null)
  const [loadErr,  setLoadErr]  = useState('')
  const [bio,      setBio]      = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [agreed,   setAgreed]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [done,     setDone]     = useState(false)

  useEffect(() => {
    if (!token) { setLoadErr('Invalid activation link.'); return }
    fetch(`/app/api/auth/activate?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setLoadErr(data.error)
        else setInfo(data)
      })
      .catch(() => setLoadErr('Something went wrong loading your info.'))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (!agreed) { setError('Please accept the community guidelines'); return }
    setLoading(true)
    try {
      const res  = await fetch('/app/api/auth/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, bio }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
      setUser({ id: data.id, name: data.name, initials: data.initials, color: data.color, role: data.role, bio: data.bio, emailVerified: data.emailVerified })
      // Tie this first session (and its replay) to the member by distinctId, the
      // same way the login flow does — activation was previously anonymous, so these
      // newcomers showed up in PostHog as throwaway UUIDs. New activations are always
      // non-staff; person props stay PII-light (we join on distinctId server-side).
      posthog.opt_in_capturing()
      posthog.identify(data.id, { role: data.role })
      posthog.capture('account_activated', { role: data.role })
      setDone(true)
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (loadErr) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-8 text-center space-y-4">
        <div className="text-4xl">😕</div>
        <p className="text-gray-700 font-semibold">{loadErr}</p>
        <p className="text-sm text-gray-400">
          If you think this is a mistake, contact us at{' '}
          <a href="mailto:info@smileyscommunity.com" className="text-amber-600 underline">info@smileyscommunity.com</a>
        </p>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-8 text-center">
        <div className="animate-spin w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full mx-auto" />
        <p className="text-sm text-gray-400 mt-3">Loading your profile…</p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-8 text-center space-y-3">
        <div className="text-5xl">🎉</div>
        <h2 className="text-xl font-bold text-gray-900">You're all set!</h2>
        <p className="text-sm text-gray-600">Taking you to Smileys…</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-7 space-y-6">
      {/* Profile snapshot */}
      <div className="flex items-center gap-4">
        {info.profilePhoto ? (
          <img src={resolveImageUrl(info.profilePhoto)} alt={info.name} className="w-16 h-16 rounded-full object-cover border-2 border-amber-200" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center text-2xl font-bold text-amber-600">
            {info.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="font-bold text-gray-900 text-lg">{info.name}</p>
          <p className="text-sm text-gray-600">{info.email}</p>
        </div>
      </div>

      {info.interests.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Your interests</p>
          <div className="flex flex-wrap gap-1.5">
            {info.interests.map(i => (
              <span key={i} className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-medium">{i}</span>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            Short bio <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="Tell the community a little about yourself…"
            rows={2}
            maxLength={200}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />
        </div>

        <div>
          <label htmlFor="act-password" className="block text-sm font-semibold text-gray-700 mb-1.5">Choose a password</label>
          <div className="relative">
            <input
              id="act-password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              required
              minLength={8}
              className="w-full px-4 py-3 pr-12 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
          </div>
        </div>

        <div>
          <label htmlFor="act-confirm" className="block text-sm font-semibold text-gray-700 mb-1.5">Confirm password</label>
          <div className="relative">
            <input
              id="act-confirm"
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="Repeat your password"
              required
              className="w-full px-4 py-3 pr-12 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={e => setAgreed(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-amber-500"
          />
          <span className="text-sm text-gray-600">
            I agree to treat every member with respect and uphold the Smileys community values.
          </span>
        </label>

        <button
          type="submit"
          disabled={loading || !agreed}
          className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 text-sm"
        >
          {loading ? 'Activating…' : 'Activate my account →'}
        </button>
      </form>
    </div>
  )
}

export default function ActivatePage() {
  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <span className="text-3xl">😊</span>
            <span className="font-bold text-xl text-gray-900">Smileys Community</span>
          </Link>
          <h1 className="text-2xl font-extrabold text-gray-900">Welcome to Smileys!</h1>
          <p className="text-sm text-gray-600 mt-1">One last step — set a password and you're in</p>
        </div>
        <Suspense fallback={
          <div className="bg-white rounded-2xl shadow-card p-8 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full mx-auto" />
          </div>
        }>
          <ActivateForm />
        </Suspense>
      </div>
    </div>
  )
}
