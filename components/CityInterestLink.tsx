'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'

// The compact "Get notified" affordance on a pre-launch city card.
//
// Same rule as JoinCityButton, in the smaller shape the card needs: a guest
// goes to the apply form (they need an account first, and the form carries the
// city through), while a signed-in member registers interest — asking an
// existing member to apply to Smileys again for a city that hasn't opened is
// nonsense, and it's what this replaces.

export default function CityInterestLink({ slug, name }: { slug: string; name: string }) {
  const { isLoggedIn } = useAuth()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/me/city-interest', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.slugs?.includes(slug)) setDone(true) })
      .catch(() => {})
  }, [isLoggedIn, slug])

  if (!isLoggedIn) {
    return (
      <Link
        href={`/apply?city=${slug}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-amber-600 transition-colors"
      >
        Get notified
        <span aria-hidden="true">→</span>
      </Link>
    )
  }

  if (done) {
    return <span className="text-sm font-semibold text-emerald-700">✓ We&rsquo;ll let you know</span>
  }

  async function register() {
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
      setDone(true)
      toast.success(`We'll let you know when ${name} opens`)
    } catch {
      toast.error('Could not save')
    } finally { setBusy(false) }
  }

  return (
    <button
      onClick={register}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-amber-600 transition-colors disabled:opacity-60"
    >
      {busy ? 'Saving…' : 'Notify me'}
      <span aria-hidden="true">→</span>
    </button>
  )
}
