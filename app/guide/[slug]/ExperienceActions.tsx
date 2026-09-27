'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'

// §11/§18 — ♡ Save (private bucket list) + ❤️ Recommend (public count).
// Client island for the buttons; the viewer's state and the count arrive
// from the page as `initial` (lib/guideTips) rather than from a fetch after
// hydration — the page is rendered per request and already knows.
//
// These sit over the hero photo. They used to be bg-white/10 — ten percent
// white over an arbitrary photograph — 36px tall, which on a phone over a
// bright image read as a smudge rather than a control. The table had zero save
// rows in production across every experience, and this is the likeliest reason.
// Now: a dark scrim with a visible border so contrast doesn't depend on the
// picture, and 44px of height, which is the touch target the rest of the app
// already holds itself to (see GuideStickyNav).
const PILL = 'inline-flex items-center gap-1.5 min-h-11 px-4 py-2.5 text-sm font-bold rounded-xl transition-colors border'
const IDLE = 'bg-black/50 hover:bg-black/65 border-white/25 text-white backdrop-blur-sm'
interface Initial { recommendCount: number; viewer: { saved: boolean; recommended: boolean; done: boolean } | null }

export default function ExperienceActions({ slug, cityName, applyHref, initial }: { slug: string; cityName: string; applyHref: string; initial: Initial }) {
  const { isLoggedIn } = useAuth()
  const [saved,       setSaved]       = useState(initial.viewer?.saved ?? false)
  const [recommended, setRecommended] = useState(initial.viewer?.recommended ?? false)
  const [done,        setDone]        = useState(initial.viewer?.done ?? false)
  const [count,       setCount]       = useState<number>(initial.recommendCount)
  const [busy,        setBusy]        = useState(false)

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
        toast.success(`Saved to My ${cityName}`)
        posthog.capture('guide_saved', { slug })
      }
      if (kind === 'recommend' && data.recommended) posthog.capture('guide_recommended', { slug })
      if (kind === 'done' && data.done) {
        toast.success(`Added to your ${cityName} story ✓`)
        posthog.capture('guide_done', { slug })
      }
    } finally {
      setBusy(false)
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href={applyHref} className={`${PILL} ${IDLE}`}>
          <span aria-hidden="true">♡</span> Save for later — join Smileys
        </Link>
        {count > 0 && (
          <span className="text-xs font-semibold text-amber-200">
            <span aria-hidden="true">❤️</span> Recommended by {count} member{count === 1 ? '' : 's'}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={() => toggle('save')} aria-pressed={saved}
        className={`${PILL} ${saved ? 'bg-amber-500 border-amber-500 text-white' : IDLE}`}>
        <span aria-hidden="true">{saved ? '♥' : '♡'}</span> {saved ? 'Saved' : 'Save'}
      </button>
      <button onClick={() => toggle('recommend')} aria-pressed={recommended}
        className={`${PILL} ${recommended ? 'bg-red-500 border-red-500 text-white' : IDLE}`}>
        <span aria-hidden="true">❤️</span> {recommended ? 'Recommended' : 'Recommend'}
      </button>
      <button onClick={() => toggle('done')} aria-pressed={done}
        className={`${PILL} ${done ? 'bg-green-600 border-green-600 text-white' : IDLE}`}>
        <span aria-hidden="true">✓</span> {done ? 'Done' : "I've done this"}
      </button>
      {count > 0 && (
        <span className="text-xs font-semibold text-amber-200">
          Recommended by {count} member{count === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}
