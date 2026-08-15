'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'

// The one place multi-city membership becomes real to a member: on a city page
// that isn't theirs, "Join Smileys <city>" adds it to their account — same
// profile, same interests, no second registration.
//
// Guests get the application link instead: becoming a member of a city you
// haven't been approved for isn't a button, it's an application. Both live in
// this one component so exactly one of them ever renders — when the page owned
// the guest link separately, a signed-in member saw both.

export default function JoinCityButton({ slug, name }: { slug: string; name: string }) {
  const { isLoggedIn } = useAuth()
  const [state, setState] = useState<'unknown' | 'member' | 'joinable'>('unknown')
  const [busy, setBusy]   = useState(false)

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/me/cities', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.cities) return
        setState(d.cities.some((c: { slug: string }) => c.slug === slug) ? 'member' : 'joinable')
      })
      // Stay 'unknown' and render nothing rather than offering a button whose
      // outcome we can't predict.
      .catch(() => {})
  }, [isLoggedIn, slug])

  // Guests: the application flow, carrying the city through.
  if (!isLoggedIn) {
    return (
      <Link href={`/apply?city=${slug}`} className="btn-primary text-base px-8 py-4">
        Join Smileys {name}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </Link>
    )
  }

  // Signed in, but we don't yet know whether they're a member — render nothing
  // rather than a button whose outcome we can't predict.
  if (state === 'unknown') return null

  if (state === 'member') {
    return (
      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-semibold">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        You&rsquo;re in {name}
      </span>
    )
  }

  async function join() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/app/api/me/cities', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Could not join'); return }
      setState('member')
      toast.success(`You're now part of Smileys ${name}`)
    } catch {
      toast.error('Could not join')
    } finally { setBusy(false) }
  }

  return (
    <button onClick={join} disabled={busy} className="btn-primary text-base px-8 py-4 disabled:opacity-60">
      {busy ? 'Joining…' : `Join Smileys ${name}`}
    </button>
  )
}
