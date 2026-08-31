'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

// One-time quote ask. Surfaces on the dashboard once a member has actually
// shown up three times (checked-in events, the strict signal) and hasn't
// already given a quote — the people whose one line belongs on the
// testimonials wall, asked at the moment they're demonstrably enjoying it.
// Submissions land hidden in /admin/stories for review; nothing goes live
// without an admin's eye.
//
// Sibling of VenueReviewPrompt (emerald) and ReviewReminder (violet); this
// one is amber, the brand's own color, because it's about Smileys itself.
// Same localStorage dismiss pattern — a single key, since there's only ever
// one of these per member.

const DISMISS_KEY = 'dismissed_testimonial_prompt'
const QUOTE_MAX = 300

export default function TestimonialPrompt({ cityName }: { cityName?: string }) {
  const [mounted,   setMounted]   = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [quote,     setQuote]     = useState('')
  const [saving,    setSaving]    = useState(false)
  const [done,      setDone]      = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      if (localStorage.getItem(DISMISS_KEY)) setDismissed(true)
    } catch { /* private mode — show it; worst case they dismiss again */ }
  }, [])

  function handleDismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
    setDismissed(true)
  }

  async function submit() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/app/api/testimonials', {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ quote: quote.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't send your quote")
        return
      }
      try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
      setDone(true)
      setTimeout(() => setDismissed(true), 2500)
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
        className="bg-amber-500 rounded-2xl p-5 text-white shadow-xl shadow-amber-500/10 mb-6"
      >
        {done ? (
          <div className="flex items-center gap-3 py-1">
            <span className="text-2xl">💛</span>
            <p className="font-bold text-sm">Thank you! We'll review it and put it up soon.</p>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl shrink-0">💬</div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base leading-tight">You've been showing up — tell us why</h3>
              <p className="text-xs text-amber-100 mt-1">
                One or two honest lines about what Smileys{cityName ? ` ${cityName}` : ''} has been like.
                The best ones go on the wall for the next person deciding whether to join.
              </p>

              <textarea
                value={quote}
                onChange={e => setQuote(e.target.value)}
                rows={2}
                maxLength={QUOTE_MAX}
                placeholder="I joined without knowing anyone, and…"
                className="w-full mt-3 px-3 py-2 text-sm rounded-xl bg-white/95 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/60 resize-none"
              />

              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={submit}
                  disabled={quote.trim().length < 20 || saving}
                  className="px-4 py-2 bg-white text-amber-700 text-xs font-bold rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Sending…' : 'Share it'}
                </button>
                <button onClick={handleDismiss} className="text-xs text-amber-100 hover:text-white font-medium px-2 py-1">
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
