'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'

interface UnreviewedEvent {
  id:    string
  title: string
  emoji: string
}

interface Props {
  events: UnreviewedEvent[]
}

export default function ReviewReminder({ events }: Props) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('dismissed_reviews')
    if (stored) {
      try {
        setDismissedIds(JSON.parse(stored))
      } catch {
        localStorage.removeItem('dismissed_reviews')
      }
    }
  }, [])

  const activeEvents = events.filter(e => !dismissedIds.includes(e.id))

  if (!mounted || activeEvents.length === 0) return null

  const next = activeEvents[0]

  const handleDismiss = () => {
    const updated = [...dismissedIds, next.id]
    setDismissedIds(updated)
    localStorage.setItem('dismissed_reviews', JSON.stringify(updated))
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-violet-600 rounded-2xl p-5 text-white shadow-xl shadow-violet-600/10 mb-6"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl shrink-0">
            {next.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base leading-tight">How was {next.title}?</h3>
            <p className="text-xs text-violet-100 mt-1">Your feedback helps hosts improve and keeps the community quality high.</p>
            
            <div className="flex items-center gap-3 mt-4">
              <Link
                href="/reviews"
                className="px-4 py-2 bg-white text-violet-600 text-xs font-bold rounded-lg hover:bg-violet-50 transition-colors"
              >
                Leave a review
              </Link>
              <button
                onClick={handleDismiss}
                className="text-xs text-violet-200 hover:text-white font-medium px-2 py-1"
              >
                Maybe later
              </button>
            </div>
          </div>
          <button onClick={handleDismiss} className="text-white/40 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
