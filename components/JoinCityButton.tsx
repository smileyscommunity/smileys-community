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

export default function JoinCityButton({
  slug,
  name,
  live = true,
}: {
  slug: string
  name: string
  // Pre-launch cities can't be joined; a signed-in member registers interest
  // instead. Sending them to /apply would ask an existing member to apply to
  // Smileys a second time.
  live?: boolean
}) {
  const { isLoggedIn, isLoading } = useAuth()
  const [state, setState] = useState<'unknown' | 'member' | 'joinable' | 'interested' | 'notify'>('unknown')
  const [busy, setBusy]   = useState(false)

  useEffect(() => {
    if (!isLoggedIn) return
    const url = live ? '/app/api/me/cities' : '/app/api/me/city-interest'
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        if (!live) { setState(d.slugs?.includes(slug) ? 'interested' : 'notify'); return }
        if (!d.cities) return
        setState(d.cities.some((c: { slug: string }) => c.slug === slug) ? 'member' : 'joinable')
      })
      // Stay 'unknown' and render nothing rather than offering a button whose
      // outcome we can't predict.
      .catch(() => {})
  }, [isLoggedIn, slug, live])

  // Auth resolves client-side and starts as "not logged in", so rendering the
  // guest CTA while it loads showed members an apply link for a second — long
  // enough to click, which is exactly how a member ended up on the application
  // form for a city they'd already joined Smileys for. Wait instead.
  if (isLoading) {
    return <span className="inline-block h-[52px] w-56 rounded-xl bg-gray-100 animate-pulse" aria-hidden="true" />
  }

  // Guests: the application flow either way — they need an account first, and
  // the form carries the city through so a pre-launch signup is captured.
  if (!isLoggedIn) {
    return (
      <Link href={`/apply?city=${slug}`} className="btn-primary text-base px-8 py-4">
        {live ? `Join Smileys ${name}` : `Get notified about ${name}`}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </Link>
    )
  }

  // Signed in, but we don't yet know whether they're a member — render nothing
  // rather than a button whose outcome we can't predict.
  if (state === 'unknown') return null

  if (state === 'interested') {
    return (
      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 text-amber-700 text-sm font-semibold">
        ✓ We&rsquo;ll tell you when {name} opens
      </span>
    )
  }

  if (state === 'notify') {
    return (
      <button onClick={registerInterest} disabled={busy} className="btn-primary text-base px-8 py-4 disabled:opacity-60">
        {busy ? 'Saving…' : `Notify me when ${name} opens`}
      </button>
    )
  }

  if (state === 'member') {
    return (
      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-semibold">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        You&rsquo;re in {name}
      </span>
    )
  }

  async function registerInterest() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/app/api/me/city-interest', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Could not save'); return }
      setState('interested')
      toast.success(`We'll let you know when ${name} opens`)
    } catch {
      toast.error('Could not save')
    } finally { setBusy(false) }
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
