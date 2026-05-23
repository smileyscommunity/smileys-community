'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import Turnstile from '@/components/Turnstile'

export default function AppealPage() {
  const [email,     setEmail]     = useState('')
  const [note,      setNote]      = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [honeypot,       setHoneypot]       = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const loadedAt = useRef(Date.now())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/app/api/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), note: note.trim(), _hp: honeypot, _t: loadedAt.current, _cf: turnstileToken }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
      setSubmitted(true)
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400'

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-card p-7">

          {submitted ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5 text-3xl">✓</div>
              <h1 className="text-xl font-extrabold text-gray-900 mb-2">Appeal submitted</h1>
              <p className="text-sm text-gray-500 mb-6">
                We've received your appeal and will review it personally. If we decide to restore your account, you'll receive an email.
              </p>
              <Link href="/login" className="text-sm font-semibold text-amber-600 hover:underline">
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4 text-2xl">🚫</div>
                <h1 className="text-xl font-extrabold text-gray-900 mb-1">Appeal your ban</h1>
                <p className="text-sm text-gray-500">
                  If you believe your account was suspended in error, tell us why. We review every appeal personally.
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <input type="text" name="website" value={honeypot} onChange={e => setHoneypot(e.target.value)}
                  tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }} />
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Email address</label>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" required className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Your appeal</label>
                  <textarea
                    value={note} onChange={e => setNote(e.target.value)}
                    placeholder="Explain why you believe the ban was unfair or what has changed since…"
                    rows={5} required
                    className={`${inputCls} resize-none`}
                  />
                  <p className="text-xs text-gray-400 mt-1">{note.length}/500 characters</p>
                </div>
                <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} />
                <button
                  type="submit" disabled={loading || !email.trim() || !note.trim()}
                  className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors disabled:opacity-50"
                >
                  {loading ? 'Submitting…' : 'Submit appeal'}
                </button>
              </form>

              <p className="text-center text-xs text-gray-400 mt-5">
                <Link href="/login" className="text-amber-600 hover:underline">Back to login</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
