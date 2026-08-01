'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { ISTANBUL_NEIGHBORHOODS, VISITOR_TRAVELER_TYPES, VISITOR_LOOKING_FOR } from '@/lib/data'
import Turnstile from '@/components/Turnstile'

// Public — POST /api/visitors already accepts anonymous submissions
// (Turnstile-verified, 3/day/IP rate-limited) as an explicit growth lever:
// non-members can announce a visit and get discovered before ever signing
// up. This page previously lived under app/(member)/, which blocked
// anonymous visitors from ever reaching the form the API was built for.
const turnstileRequired = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

export default function NewVisitingPage() {
  const router = useRouter()
  const { user, isLoggedIn } = useAuth()

  const [name,         setName]         = useState('')
  const [fromCity,     setFromCity]     = useState('')
  const [startsOn,     setStartsOn]     = useState('')
  const [endsOn,       setEndsOn]       = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [intro,        setIntro]        = useState('')
  const [contact,      setContact]      = useState('')
  const [travelerType, setTravelerType] = useState('')
  const [languages,    setLanguages]    = useState('')
  const [lookingFor,   setLookingFor]   = useState<string[]>([])
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState('')

  function toggleLookingFor(value: string) {
    setLookingFor(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  // Turnstile tokens are single-use — a failed submit consumes the current
  // one, so resetSignal forces the widget to mint a fresh one on retry.
  // Members skip this entirely: the API only requires it when there's no
  // session.
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)

  useEffect(() => {
    if (user.name && !name) setName(user.name)
  }, [user.name, name])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim() || !intro.trim() || !startsOn || !endsOn) {
      setError('Name, intro, and dates are required')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/app/api/visitors', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, fromCity: fromCity || undefined,
          intro, startsOn, endsOn, neighborhood: neighborhood || undefined,
          contact: contact || undefined,
          travelerType: travelerType || undefined,
          languages: languages.split(',').map(l => l.trim()).filter(Boolean),
          lookingFor,
          _cf: !isLoggedIn ? turnstileToken : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not post')
        if (!isLoggedIn) { setTurnstileToken(''); setTurnstileReset(n => n + 1) }
        return
      }
      router.push('/visiting')
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const todayStr = new Date().toISOString().split('T')[0]
  const canSubmit = !submitting && (isLoggedIn || !turnstileRequired || !!turnstileToken)

  return (
    <div className="min-h-screen bg-warm pb-16">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8 pb-6">
          <Link href="/visiting" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1 transition-colors">
            ← All visitors
          </Link>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Post your visit</h1>
          <p className="text-base text-gray-600 mt-1">Members in Istanbul will see this and can reach out.</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8">
        <form onSubmit={handleSubmit} className="space-y-5 pb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Your name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={80}
                placeholder="First name" className="input" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Coming from <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input type="text" value={fromCity} onChange={e => setFromCity(e.target.value)} maxLength={80}
                placeholder="Berlin, Mumbai…" className="input" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">From</label>
              <input type="date" value={startsOn} min={todayStr} onChange={e => setStartsOn(e.target.value)} className="input" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">To</label>
              <input type="date" value={endsOn} min={startsOn || todayStr} onChange={e => setEndsOn(e.target.value)} className="input" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Where you&apos;ll be staying <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <select value={neighborhood} onChange={e => setNeighborhood(e.target.value)} className="input bg-white">
              <option value="">— Not sure yet —</option>
              {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">Locals from that area get notified.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Traveler type <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <select value={travelerType} onChange={e => setTravelerType(e.target.value)} className="input bg-white">
                <option value="">— Not sure —</option>
                {VISITOR_TRAVELER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Languages <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input type="text" value={languages} onChange={e => setLanguages(e.target.value)} maxLength={200}
                placeholder="English, Spanish…" className="input" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              What are you looking for? <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {VISITOR_LOOKING_FOR.map(t => {
                const active = lookingFor.includes(t.value)
                return (
                  <button key={t.value} type="button" onClick={() => toggleLookingFor(t.value)}
                    className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors ${
                      active ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300'
                    }`}>
                    {t.emoji} {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">A short intro</label>
            <textarea value={intro} onChange={e => setIntro(e.target.value)} maxLength={1000} rows={4}
              placeholder="Why you're visiting, what you're hoping to do, what kind of company you'd enjoy…"
              className="input resize-none" />
            <p className="text-right text-xs text-gray-400 mt-1">{intro.length}/1000</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              WhatsApp / Instagram <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input type="text" value={contact} onChange={e => setContact(e.target.value)} maxLength={200}
              placeholder="+90 ... or @handle" className="input" />
          </div>

          {/* Anonymous posters only — members are already gated by login,
              matching how POST /api/visitors decides whether to require a
              token. */}
          {!isLoggedIn && (
            <Turnstile onVerify={setTurnstileToken} onExpire={() => setTurnstileToken('')} resetSignal={turnstileReset} />
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

          <button type="submit" disabled={!canSubmit}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors">
            {submitting ? 'Posting…' : 'Post visit'}
          </button>
        </form>
      </div>
    </div>
  )
}
