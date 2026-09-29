'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'

// Compact card-level "Get notified" for coming-soon city cards — the one-tap
// version of JoinCityButton's pre-launch flow (same APIs, same semantics),
// sized for a card footer. Rendered ABOVE the card's stretched link
// (relative z-10 at the callsite), so it must stop propagation to stay a
// button rather than a navigation.
export default function CityNotifyChip({ slug, name }: { slug: string; name: string }) {
  const { isLoggedIn, isLoading } = useAuth()
  const [state, setState] = useState<'unknown' | 'interested' | 'notify'>('unknown')
  const [busy, setBusy]   = useState(false)

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/me/city-interest', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setState(d.slugs?.includes(slug) ? 'interested' : 'notify') })
      .catch(() => {})
  }, [isLoggedIn, slug])

  // While auth resolves, show nothing — the card's own link still works.
  if (isLoading) return null

  // Guests: the apply flow captures pre-launch interest with the city attached.
  if (!isLoggedIn) {
    return (
      <Link href={`/apply?city=${slug}`} onClick={e => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors">
        🔔 Get notified
      </Link>
    )
  }

  if (state === 'interested') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 text-amber-700 text-xs font-semibold">
        ✓ On the list
      </span>
    )
  }

  if (state !== 'notify') return null

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async e => {
        e.preventDefault(); e.stopPropagation()
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
          toast.success(`We'll tell you when ${name} opens`)
        } catch {
          toast.error('Could not save')
        } finally { setBusy(false) }
      }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors disabled:opacity-60">
      {busy ? 'Saving…' : '🔔 Get notified'}
    </button>
  )
}
