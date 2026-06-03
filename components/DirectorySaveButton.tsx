'use client'

// Star/save toggle on each directory card. Optimistic toggle, rolls
// back on a !ok response so the UI doesn't drift from the server.
//
// Anonymous viewers see a star button that links to /login?next=
// instead of trying to POST — the API would 401 anyway, and bouncing
// them to login is the natural conversion path.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function DirectorySaveButton({
  businessId, businessName, initialSaved, isLoggedIn,
}: {
  businessId: string
  businessName: string
  initialSaved: boolean
  isLoggedIn: boolean
}) {
  const router = useRouter()
  const [saved, setSaved] = useState(initialSaved)
  const [busy,  setBusy]  = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!isLoggedIn) {
      router.push('/login?next=' + encodeURIComponent('/directory'))
      return
    }
    if (busy) return
    setBusy(true)
    const next = !saved
    setSaved(next)
    try {
      const r = await fetch(`/app/api/directory/${businessId}/save`, {
        method: 'POST', credentials: 'include',
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setSaved(!next)
        toast.error(d?.error || 'Failed to update')
        return
      }
      // Server tells us the resulting state — trust it over our
      // optimistic guess (handles race conditions cleanly).
      if (typeof d.saved === 'boolean') setSaved(d.saved)
    } catch {
      setSaved(!next)
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={saved ? `Unsave ${businessName}` : `Save ${businessName}`}
      title={saved ? 'Saved' : isLoggedIn ? 'Save for later' : 'Log in to save'}
      className={`w-7 h-7 rounded-full flex items-center justify-center shadow-sm transition-all duration-150 ${
        saved
          ? 'bg-amber-500 text-white hover:bg-amber-600'
          : 'bg-white/95 text-gray-500 hover:text-amber-600'
      } ${busy ? 'opacity-50' : ''}`}
    >
      {/* Filled vs outline star. Inline SVG so we don't pull a whole
          icon library for one glyph. */}
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.075 10.1c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.518-4.674z" />
      </svg>
    </button>
  )
}
