'use client'

import { useState, useRef } from 'react'
import Turnstile from '@/components/Turnstile'

const INDUSTRIES = [
  'Tech & Startups', 'Finance', 'Marketing & Comms', 'Design & Creative',
  'Real Estate', 'Legal', 'Hospitality', 'Healthcare', 'Education',
  'Consulting', 'Other',
]

interface Props {
  initialEmail:      string
  initialName:       string
  alreadyJoined:     boolean
  foundersRemaining: number
}

export default function ProWaitlistForm({ initialEmail, initialName, alreadyJoined, foundersRemaining }: Props) {
  const [name,      setName]      = useState(initialName)
  const [email,     setEmail]     = useState(initialEmail)
  const [industry,  setIndustry]  = useState('')
  const [role,      setRole]      = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [result,    setResult]    = useState<{ position: number; founderCap: number; isFounder: boolean } | null>(null)
  const [honeypot,       setHoneypot]       = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const loadedAt = useRef(Date.now())

  const isLoggedIn = !!initialEmail

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/app/api/pro/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: isLoggedIn ? undefined : name,
          email: isLoggedIn ? undefined : email,
          industry: industry || undefined,
          role:     role.trim() || undefined,
          _hp: honeypot,
          _t:  loadedAt.current,
          _cf: turnstileToken,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
      setResult(data)
    } finally {
      setLoading(false)
    }
  }

  // Already on the waitlist — show celebratory state instead of the form.
  if (alreadyJoined && !result) {
    return (
      <div id="join" className="bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/30 rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">🪪</span>
          <div>
            <h3 className="font-extrabold text-amber-300 text-xl">You're in.</h3>
            <p className="text-sm text-zinc-300 mt-0.5">Your seat is reserved. We'll email you the moment Pro opens.</p>
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          Want to bump your priority? Forward this page to one professional friend — referred founders skip to the front of the cohort.
        </p>
      </div>
    )
  }

  if (result) {
    return (
      <div id="join" className="bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/30 rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-4xl">{result.isFounder ? '🪪' : '🎉'}</span>
          <div>
            <h3 className="font-extrabold text-amber-300 text-xl">
              {result.isFounder ? `You're founder #${result.position}.` : `You're #${result.position} on the waitlist.`}
            </h3>
            <p className="text-sm text-zinc-300 mt-0.5">
              {result.isFounder
                ? 'Founder rate locked in. We\'ll email you the moment Pro opens.'
                : `${result.founderCap} founder seats filled. You're in line for the next intake.`}
            </p>
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          {result.isFounder
            ? 'Refer a friend and they skip straight to the founder pool too — first 100 only.'
            : 'Want to move up? Refer professional friends and you both jump the queue.'}
        </p>
      </div>
    )
  }

  return (
    <form id="join" onSubmit={handleSubmit} noValidate className="bg-white/5 border border-white/10 rounded-2xl p-6 max-w-xl">
      <input type="text" name="website" value={honeypot} onChange={e => setHoneypot(e.target.value)}
        tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }} />

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Your name" required disabled={isLoggedIn}
          className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-50"
        />
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com" required disabled={isLoggedIn}
          className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-50"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <select value={industry} onChange={e => setIndustry(e.target.value)}
          className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-amber-500">
          <option value="">Industry (optional)</option>
          {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <input
          type="text" value={role} onChange={e => setRole(e.target.value)}
          placeholder="Role — e.g. Founder, Designer"
          className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
        />
      </div>

      {!isLoggedIn && (
        <div className="mb-4">
          <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} />
        </div>
      )}

      <button
        type="submit"
        disabled={loading || (!isLoggedIn && (!name.trim() || !email.trim()))}
        className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm transition-colors disabled:opacity-50">
        {loading
          ? 'Reserving…'
          : foundersRemaining > 0
            ? `Reserve founder spot #${(101 - foundersRemaining)} →`
            : 'Join the waitlist →'}
      </button>

      <p className="text-center text-xs text-zinc-500 mt-3">
        One email per person. We'll only contact you about Pro.
      </p>
    </form>
  )
}
