'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

// Post-visit venue review prompt. Surfaces on the dashboard for the
// member's most-recent checked-in event whose venue is a live directory
// listing they haven't reviewed yet — the moment of highest recall, and
// (unlike the weekly in-app nudge) a surface every active member actually
// sees. Reviews inline in one tap so there's no click-through to lose.
//
// Sibling of ReviewReminder (event feedback, violet); this is venue
// feedback (emerald). Same localStorage dismiss pattern, keyed by
// businessId so dismissing one venue doesn't suppress the next.

interface Props {
  businessId:   string
  businessName: string
  eventTitle:   string
}

const RATING_LABELS: Record<number, string> = {
  1: 'Awful', 2: 'Poor', 3: 'OK', 4: 'Good', 5: 'Loved it',
}

export default function VenueReviewPrompt({ businessId, businessName, eventTitle }: Props) {
  const [mounted,   setMounted]   = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [rating,    setRating]    = useState(0)
  const [comment,   setComment]   = useState('')
  const [saving,    setSaving]    = useState(false)
  const [done,      setDone]      = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const stored: string[] = JSON.parse(localStorage.getItem('dismissed_venue_reviews') ?? '[]')
      if (stored.includes(businessId)) setDismissed(true)
    } catch {
      localStorage.removeItem('dismissed_venue_reviews')
    }
  }, [businessId])

  function persistDismiss() {
    try {
      const stored: string[] = JSON.parse(localStorage.getItem('dismissed_venue_reviews') ?? '[]')
      if (!stored.includes(businessId)) {
        localStorage.setItem('dismissed_venue_reviews', JSON.stringify([...stored, businessId]))
      }
    } catch {
      localStorage.setItem('dismissed_venue_reviews', JSON.stringify([businessId]))
    }
  }

  function handleDismiss() {
    persistDismiss()
    setDismissed(true)
  }

  async function submit() {
    if (rating < 1 || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/app/api/directory/${businessId}/reviews`, {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rating, comment: comment.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't post your review")
        return
      }
      // Persist dismissal so the reviewed venue doesn't reappear before the
      // dashboard re-queries (the server filter excludes it on next load).
      persistDismiss()
      setDone(true)
      setTimeout(() => setDismissed(true), 1800)
    } catch {
      toast.error('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (!mounted || dismissed) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-emerald-600 rounded-2xl p-5 text-white shadow-xl shadow-emerald-600/10 mb-6"
      >
        {done ? (
          <div className="flex items-center gap-3 py-1">
            <span className="text-2xl">🎉</span>
            <p className="font-bold text-sm">Thanks! Your review of {businessName} is live.</p>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl shrink-0">📍</div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base leading-tight">How was {businessName}?</h3>
              <p className="text-xs text-emerald-100 mt-1">
                You checked in at {eventTitle} there — a quick rating helps other members find it.
              </p>

              <div className="flex items-center gap-3 mt-3">
                <div className="flex gap-0.5 text-2xl leading-none">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      className="cursor-pointer hover:scale-110 transition-transform"
                      aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    >
                      <span className={n <= rating ? 'text-amber-300' : 'text-white/30'}>★</span>
                    </button>
                  ))}
                </div>
                {rating > 0 && <span className="text-xs font-semibold text-emerald-50">{RATING_LABELS[rating]}</span>}
              </div>

              {rating > 0 && (
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={2}
                  maxLength={1500}
                  placeholder="Add a few words (optional)…"
                  className="w-full mt-3 px-3 py-2 text-sm rounded-xl bg-white/95 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/60 resize-none"
                />
              )}

              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={submit}
                  disabled={rating < 1 || saving}
                  className="px-4 py-2 bg-white text-emerald-700 text-xs font-bold rounded-lg hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Posting…' : 'Post review'}
                </button>
                <button onClick={handleDismiss} className="text-xs text-emerald-100 hover:text-white font-medium px-2 py-1">
                  Maybe later
                </button>
              </div>
            </div>

            <button onClick={handleDismiss} className="text-white/40 hover:text-white" aria-label="Dismiss">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
