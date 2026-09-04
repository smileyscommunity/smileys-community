'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// Cancel a hangout from the permalink page (host or staff).
//
// The feed card has had this since the beginning, but the feed only lists
// active hangouts in the VIEWER's current city — so anyone who arrived here
// from a share link, a push notification, or another city had no way to call
// a plan off at all. Same DELETE the feed and the admin table use.
//
// Two-state inline confirm, not a native confirm() — those silently no-op in
// the installed PWA. On success we router.refresh() rather than navigate: the
// page re-renders with the "❌ This hangout was cancelled" banner, which is
// the confirmation.
export default function HangoutCancelButton({ hangoutId, isOwner }: { hangoutId: string; isOwner: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [loading,    setLoading]    = useState(false)
  const router = useRouter()

  async function cancel() {
    setLoading(true)
    try {
      const res = await fetch(`/app/api/hangouts/${hangoutId}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? 'Could not cancel')
        return
      }
      setConfirming(false)
      toast.success('Cancelled — everyone who joined has been notified')
      router.refresh()
    } catch {
      toast.error('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center justify-center gap-3">
        <button onClick={cancel} disabled={loading}
          className="text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-50">
          Yes, cancel it
        </button>
        <span className="text-xs text-gray-300">/</span>
        <button onClick={() => setConfirming(false)} disabled={loading}
          className="text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-50">
          Keep it
        </button>
      </div>
    )
  }

  return (
    <div className="flex justify-center">
      <button onClick={() => setConfirming(true)}
        className="text-xs font-semibold text-gray-400 hover:text-gray-700">
        {isOwner ? 'Cancel this hangout' : 'Cancel this hangout (moderator)'}
      </button>
    </div>
  )
}
