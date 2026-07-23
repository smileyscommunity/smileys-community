'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// Like button for a handbook article. Sits with the share row at the
// end of the piece — you like something after reading it, not before.
//
// The handbook is public, so this renders for logged-out visitors too:
// they see the count, and tapping sends them to sign in rather than
// firing a request that would 401.
//
// Optimistic: the count/heart flip immediately and roll back if the
// POST fails, so a like feels instant on a slow mobile connection.

interface Props {
  slug:         string
  initialCount: number
  initialLiked: boolean
  isLoggedIn:   boolean
}

export default function ArticleLike({ slug, initialCount, initialLiked, isLoggedIn }: Props) {
  const router = useRouter()
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(initialCount)
  const [busy,  setBusy]  = useState(false)

  async function toggle() {
    if (!isLoggedIn) {
      // Guests: send them to sign in rather than 401ing. The handbook is
      // a top-of-funnel surface, so this doubles as a join nudge.
      router.push('/login')
      return
    }
    if (busy) return

    const prevLiked = liked
    const prevCount = count
    setLiked(!prevLiked)
    setCount(prevCount + (prevLiked ? -1 : 1))
    setBusy(true)
    try {
      const res = await fetch(`/app/api/handbook/${encodeURIComponent(slug)}/like`, {
        method: 'POST', credentials: 'include',
      })
      if (!res.ok) throw new Error('request failed')
      // Trust the server's numbers over the optimistic guess — keeps the
      // count honest when two devices like the same article at once.
      const d = await res.json()
      setLiked(d.liked)
      setCount(d.count)
    } catch {
      setLiked(prevLiked)
      setCount(prevCount)
      toast.error('Could not save that — check your connection')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={liked}
      aria-label={liked ? 'Unlike this article' : 'Like this article'}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-colors disabled:opacity-60 ${
        liked
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-600'
      }`}>
      <span aria-hidden="true" className={liked ? '' : 'grayscale opacity-70'}>❤️</span>
      <span className="tabular-nums">{count}</span>
      <span className="sr-only">{count === 1 ? 'like' : 'likes'}</span>
    </button>
  )
}
