'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DISMISSED_KEY, SNOOZE_KEY, parseDismissedIds, isSnoozed, snoozeUntil,
} from '@/lib/reviewReminder'

interface UnreviewedEvent {
  id:    string
  title: string
  emoji: string
}

interface Props {
  events: UnreviewedEvent[]
}

// Storage can throw (private mode, blocked site data); the reminder must not
// take the dashboard with it.
function storageGet(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } }
function storageSet(key: string, value: string): void { try { localStorage.setItem(key, value) } catch {} }

export default function ReviewReminder({ events }: Props) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [snoozed, setSnoozed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setDismissedIds(parseDismissedIds(storageGet(DISMISSED_KEY)))
    setSnoozed(isSnoozed(storageGet(SNOOZE_KEY), Date.now()))
  }, [])

  const activeEvents = events.filter(e => !dismissedIds.includes(e.id))

  if (!mounted || snoozed || activeEvents.length === 0) return null

  const next = activeEvents[0]

  // "Maybe later": not now, for any event — back in a week.
  const handleSnooze = () => {
    storageSet(SNOOZE_KEY, snoozeUntil(Date.now()))
    setSnoozed(true)
  }

  // ✕: never ask about this event again.
  const handleDismiss = () => {
    const updated = [...dismissedIds, next.id]
    setDismissedIds(updated)
    storageSet(DISMISSED_KEY, JSON.stringify(updated))
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
                onClick={handleSnooze}
                className="text-xs text-violet-200 hover:text-white font-medium px-2 py-1"
              >
                Maybe later
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/40 hover:text-white"
            aria-label={`Don't ask again about ${next.title}`}
            title="Don't ask again"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
