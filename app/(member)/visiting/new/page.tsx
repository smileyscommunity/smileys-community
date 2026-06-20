'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'

export default function NewVisitingPage() {
  const router = useRouter()
  const { user } = useAuth()

  const [name,         setName]         = useState('')
  const [fromCity,     setFromCity]     = useState('')
  const [startsOn,     setStartsOn]     = useState('')
  const [endsOn,       setEndsOn]       = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [intro,        setIntro]        = useState('')
  const [contact,      setContact]      = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState('')

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
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not post'); return }
      router.push('/visiting')
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const todayStr = new Date().toISOString().split('T')[0]

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

          {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

          <button type="submit" disabled={submitting}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors">
            {submitting ? 'Posting…' : 'Post visit'}
          </button>
        </form>
      </div>
    </div>
  )
}
