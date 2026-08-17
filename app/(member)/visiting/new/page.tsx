'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { VISITOR_TRAVELER_TYPES, VISITOR_LOOKING_FOR, VISITOR_VISIBILITY } from '@/lib/data'

type PublicCity = { slug: string; name: string; status: string }

export default function NewVisitingPage() {
  const { user } = useAuth()

  // Destination: which Smileys city this visit is TO. The picker only
  // renders once a second city exists (same progressive reveal as the
  // apply form) — Istanbul-only stays a one-city form.
  const [cities,        setCities]        = useState<PublicCity[]>([])
  const [destination,   setDestination]   = useState('istanbul')
  // ?city=<slug> preselects the destination — the /[city] pages' "Announce
  // your visit" arrives here. Applied only once the live-city list confirms
  // the slug, so a junk param can't select an unpostable destination.
  const requestedCity = useSearchParams().get('city')
  const [neighborhoods, setNeighborhoods] = useState<string[]>([])

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
  const [visibility,   setVisibility]   = useState<string>('members')
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState('')
  // Set once the post succeeds — swaps the whole form for the confirmation
  // rather than bouncing to /visiting, so the payoff ("Istanbul knows you're
  // coming") lands before the visitor goes looking for their own card.
  const [posted,       setPosted]       = useState(false)

  function toggleLookingFor(value: string) {
    setLookingFor(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  useEffect(() => {
    if (user.name && !name) setName(user.name)
  }, [user.name, name])

  useEffect(() => {
    // Visitable = LIVE only: a visit needs a community that can actually
    // see it and respond. The API enforces the same rule; with one live
    // city the picker simply never renders.
    fetch('/app/api/cities')
      .then(r => r.json())
      .then((rows: PublicCity[]) => {
        const live = rows.filter(c => c.status === 'live')
        setCities(live)
        if (requestedCity && live.some(c => c.slug === requestedCity)) setDestination(requestedCity)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    // Neighborhood options follow the destination; clear a stale pick when
    // the destination changes so an Istanbul neighborhood can't ride along
    // on an Izmir visit. The cancelled flag drops out-of-order responses —
    // a slow earlier fetch must not overwrite a faster later one.
    let cancelled = false
    setNeighborhood('')
    fetch(`/app/api/neighborhoods?city=${encodeURIComponent(destination)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setNeighborhoods((d.neighborhoods ?? []).map((n: { name: string }) => n.name)) })
      .catch(() => { if (!cancelled) setNeighborhoods([]) })
    return () => { cancelled = true }
  }, [destination])

  const cityName = cities.find(c => c.slug === destination)?.name ?? 'Istanbul'

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
          name, city: destination, fromCity: fromCity || undefined,
          intro, startsOn, endsOn, neighborhood: neighborhood || undefined,
          contact: contact || undefined,
          travelerType: travelerType || undefined,
          languages: languages.split(',').map(l => l.trim()).filter(Boolean),
          lookingFor,
          visibility,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not post'); return }
      setPosted(true)
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const todayStr = new Date().toISOString().split('T')[0]

  async function shareVisit() {
    const url = `${window.location.origin}/app/visiting`
    // Native share sheet on mobile, clipboard everywhere else. A cancelled
    // share rejects, which is not an error worth surfacing.
    if (navigator.share) {
      try { await navigator.share({ title: `My ${cityName} visit`, url }) } catch { /* dismissed */ }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  if (posted) {
    return (
      <div className="min-h-screen bg-warm">
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <div aria-hidden="true" className="text-6xl mb-6">👋</div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
            {cityName} knows you&apos;re coming.
          </h1>
          <p className="text-base text-gray-700 mt-4">
            Your visit is now visible to the Smileys community.
          </p>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">
            Members can welcome you, share recommendations and invite you to join them while you&apos;re here.
          </p>
          {visibility === 'members' && (
            <p className="text-xs text-gray-500 mt-4 bg-white border border-gray-200 rounded-xl px-4 py-3 inline-block">
              🔒 Only signed-in Smileys members can see your visit. You can change this any time.
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 mt-8">
            <Link href="/visiting"
              className="flex-1 inline-flex items-center justify-center px-6 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-colors">
              See my visitor card
            </Link>
            <Link href={destination === 'istanbul' ? '/neighborhoods' : `/${destination}`}
              className="flex-1 inline-flex items-center justify-center px-6 py-3.5 border border-gray-200 hover:bg-white text-gray-700 font-bold rounded-xl transition-colors">
              Explore {cityName}
            </Link>
          </div>
          <button onClick={shareVisit}
            className="mt-5 text-sm font-semibold text-gray-500 hover:text-amber-600 transition-colors">
            Share my visit
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-warm pb-16">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8 pb-6">
          <Link href="/visiting" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1 transition-colors">
            ← All visitors
          </Link>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Coming to {cities.length > 1 ? cityName : 'Istanbul'}?</h1>
          <p className="text-base text-gray-600 mt-1">
            Put yourself on the Smileys radar and start making connections before you arrive.
          </p>
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

          {cities.length > 1 && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Where are you visiting?</label>
              <select value={destination} onChange={e => setDestination(e.target.value)} className="input bg-white">
                {cities.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
          )}

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
              {neighborhoods.map(n => <option key={n} value={n}>{n}</option>)}
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

          {/* Defaults to members-only. Radios rather than a toggle so both
              outcomes are stated outright — someone posting travel dates
              should never have to infer what a switch position means. */}
          <fieldset>
            <legend className="block text-sm font-semibold text-gray-700 mb-1.5">Who can see my visit?</legend>
            <div className="space-y-2">
              {VISITOR_VISIBILITY.map(v => (
                <label key={v.value}
                  className={`flex items-start gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
                    visibility === v.value ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white hover:border-amber-200'
                  }`}>
                  <input type="radio" name="visibility" value={v.value}
                    checked={visibility === v.value}
                    onChange={() => setVisibility(v.value)}
                    className="mt-0.5 accent-amber-500" />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">{v.label}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{v.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

          <button type="submit" disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors">
            {submitting ? 'Posting…' : (
              <>
                Let {cityName} Know I&apos;m Coming
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
