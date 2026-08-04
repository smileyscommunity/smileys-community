'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'

// §11/§18 — ♡ Save (private bucket list) + ❤️ Recommend (public count).
// Client island so the ISR-cached experience page stays shared HTML;
// viewer state arrives from /api/guide/[slug] after hydration.
export default function ExperienceActions({ slug }: { slug: string }) {
  const { isLoggedIn } = useAuth()
  const [saved,       setSaved]       = useState(false)
  const [recommended, setRecommended] = useState(false)
  const [done,        setDone]        = useState(false)
  const [count,       setCount]       = useState<number | null>(null)
  const [busy,        setBusy]        = useState(false)

  useEffect(() => {
    fetch(`/app/api/guide/${slug}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setCount(d.recommendCount)
        if (d.viewer) { setSaved(d.viewer.saved); setRecommended(d.viewer.recommended); setDone(d.viewer.done ?? false) }
      })
      .catch(() => {})
  }, [slug])

  async function toggle(kind: 'save' | 'recommend' | 'done') {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/app/api/guide/${slug}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Something went wrong'); return }
      setSaved(data.saved)
      setRecommended(data.recommended)
      setDone(data.done ?? false)
      setCount(data.recommendCount)
      if (kind === 'save' && data.saved) {
        toast.success('Saved to My Istanbul')
        posthog.capture('guide_saved', { slug })
      }
      if (kind === 'recommend' && data.recommended) posthog.capture('guide_recommended', { slug })
      if (kind === 'done' && data.done) {
        toast.success('Added to your Istanbul story ✓')
        posthog.capture('guide_done', { slug })
      }
    } finally {
      setBusy(false)
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/apply"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-xl transition-colors backdrop-blur-sm">
          <span aria-hidden="true">♡</span> Save for later — join Smileys
        </Link>
        {(count ?? 0) > 0 && (
          <span className="text-xs font-semibold text-amber-200">
            <span aria-hidden="true">❤️</span> Recommended by {count} Smileys
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={() => toggle('save')} aria-pressed={saved}
        className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl transition-colors backdrop-blur-sm ${
          saved ? 'bg-amber-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
        }`}>
        <span aria-hidden="true">{saved ? '♥' : '♡'}</span> {saved ? 'Saved' : 'Save'}
      </button>
      <button onClick={() => toggle('recommend')} aria-pressed={recommended}
        className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl transition-colors backdrop-blur-sm ${
          recommended ? 'bg-red-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
        }`}>
        <span aria-hidden="true">❤️</span> {recommended ? 'Recommended' : 'Recommend'}
      </button>
      <button onClick={() => toggle('done')} aria-pressed={done}
        className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl transition-colors backdrop-blur-sm ${
          done ? 'bg-green-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
        }`}>
        <span aria-hidden="true">✓</span> {done ? 'Done' : "I've done this"}
      </button>
      {(count ?? 0) > 0 && (
        <span className="text-xs font-semibold text-amber-200">
          Recommended by {count} Smileys
        </span>
      )}
    </div>
  )
}
