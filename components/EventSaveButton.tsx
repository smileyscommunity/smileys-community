'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'

// ♡ Save an event (Events brief §35) — a bookmark, not an RSVP. Kept
// visually quiet so it never competes with the Join CTA: saving is the
// "maybe later" action, joining is the point of the page.
export default function EventSaveButton({ eventId, initialSaved = false, className = '' }: {
  eventId: string
  initialSaved?: boolean
  className?: string
}) {
  const { isLoggedIn } = useAuth()
  const [saved, setSaved] = useState(initialSaved)
  const [busy,  setBusy]  = useState(false)

  if (!isLoggedIn) return null

  async function toggle() {
    if (busy) return
    setBusy(true)
    // Optimistic: the toggle is cheap and idempotent server-side, so a
    // failure simply reverts.
    const next = !saved
    setSaved(next)
    try {
      const res = await fetch(`/app/api/events/${eventId}/save`, { method: 'POST', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaved(!next)
        toast.error(data.error ?? 'Could not save')
        return
      }
      setSaved(data.saved)
      if (data.saved) {
        posthog.capture('event_saved', { eventId })
        toast.success('Saved to My Events')
      }
    } catch {
      setSaved(!next)
      toast.error('Network error — check your connection')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button onClick={toggle} disabled={busy} aria-pressed={saved}
      aria-label={saved ? 'Remove from saved events' : 'Save this event'}
      className={`inline-flex items-center gap-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
        saved ? 'text-red-500' : 'text-gray-500 hover:text-red-400'
      } ${className}`}>
      <span aria-hidden="true">{saved ? '♥' : '♡'}</span>
      {saved ? 'Saved' : 'Save'}
    </button>
  )
}
