'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// Join / leave a hangout from the permalink page. The feed has its own inline
// version; this mirrors it so a shared link is actionable (join right there)
// instead of a dead end that sends you hunting through the feed.
export default function HangoutJoinButton({ hangoutId, initialJoined }: { hangoutId: string; initialJoined: boolean }) {
  const [joined,  setJoined]  = useState(initialJoined)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function toggle() {
    setLoading(true)
    try {
      const res = await fetch(`/app/api/hangouts/${hangoutId}/join`, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? 'Could not update')
        return
      }
      const d = await res.json()
      setJoined(d.joined)
      toast.success(d.joined ? "You're in ✓" : 'Left the hangout')
      // Re-render the server page so the discussion composer + joiners list
      // reflect the new membership.
      router.refresh()
    } catch {
      toast.error('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`w-full text-sm font-bold px-4 py-3 rounded-2xl transition-colors disabled:opacity-50 ${
        joined
          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
          : 'bg-amber-500 text-white hover:bg-amber-600'
      }`}
    >
      {joined ? "You're in ✓ · tap to leave" : "I'm in"}
    </button>
  )
}
