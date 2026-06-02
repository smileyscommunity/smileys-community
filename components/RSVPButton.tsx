'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { motion, AnimatePresence } from 'framer-motion'
import { useRSVP } from '@/hooks/useRSVP'

interface Props {
  eventId:      string
  hostId:       string
  spotsLeft:    number
  price:        number
  memberPrice?: number
  membersOnly:  boolean
  currency?:    string
}

const SYMBOLS: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' }

export default function RSVPButton({ eventId, hostId, spotsLeft, price, memberPrice, membersOnly, currency = 'TRY' }: Props) {
  const { isLoggedIn, user } = useAuth()
  const { status, position, loading, checked, join, leave } = useRSVP(eventId)
  const sym = SYMBOLS[currency] ?? currency
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [stealth,       setStealth]       = useState(false)
  const [showStealth,   setShowStealth]   = useState(false)

  function handleLeave() {
    if (price > 0 && status === 'joined') {
      setConfirmCancel(true)
    } else {
      leave()
    }
  }

  const isFull = spotsLeft <= 0

  if (!checked) return <div className="w-full h-12 bg-gray-100 rounded-xl animate-pulse mb-3" />

  if (isLoggedIn && user.id === hostId) {
    return (
      <div className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-blue-50 border-2 border-blue-200 text-blue-700 font-semibold rounded-xl text-sm mb-3">
        🎤 You're hosting this event
      </div>
    )
  }

  const ease = [0.22, 1, 0.36, 1] as [number, number, number, number]
  const slide = {
    initial:    { opacity: 0, y: 10,  scale: 0.97 },
    animate:    { opacity: 1, y: 0,   scale: 1    },
    exit:       { opacity: 0, y: -10, scale: 0.97 },
    transition: { duration: 0.2, ease },
  }

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        {status === 'pending' ? (
          <motion.div key="pending" {...slide} className="space-y-2 mb-3">
            <div className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-amber-50 border-2 border-amber-200 text-amber-700 font-semibold rounded-xl text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Pending approval
            </div>
            <button onClick={leave} disabled={loading}
              className="w-full py-2 text-xs text-gray-400 hover:text-red-500 transition-colors">
              {loading ? 'Cancelling…' : 'Cancel request'}
            </button>
          </motion.div>
        ) : status === 'joined' ? (
          <motion.div key="attending" {...slide} className="space-y-2 mb-3">
            <div className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-green-50 border-2 border-green-200 text-green-700 font-semibold rounded-xl text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              You're attending
            </div>
            <button onClick={handleLeave} disabled={loading}
              className="w-full py-2 text-xs text-gray-400 hover:text-red-500 transition-colors">
              {loading ? 'Cancelling…' : 'Cancel registration'}
            </button>
          </motion.div>
        ) : status === 'waitlisted' ? (
          <motion.div key="waitlisted" {...slide} className="space-y-2 mb-3">
            <div className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-amber-50 border-2 border-amber-200 text-amber-700 font-semibold rounded-xl text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Waitlisted {position ? `— #${position}` : ''}
            </div>
            <button onClick={leave} disabled={loading}
              className="w-full py-2 text-xs text-gray-400 hover:text-red-500 transition-colors">
              {loading ? 'Removing…' : 'Leave waitlist'}
            </button>
          </motion.div>
        ) : (
          <motion.div key="idle" {...slide}>
            {showStealth && (
              <div className="flex items-center justify-between mb-3 px-1">
                <div>
                  <p className="text-xs font-semibold text-gray-700">Attend anonymously</p>
                  <p className="text-xs text-gray-400">Your name won't appear on the attendee list</p>
                </div>
                <button onClick={() => setStealth(s => !s)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${stealth ? 'bg-amber-500' : 'bg-gray-200'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${stealth ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            )}
            <div className="flex gap-2 mb-3">
            <motion.button
              onClick={() => join(stealth)}
              disabled={loading}
              whileTap={{ scale: 0.96 }}
              className={`w-full justify-center text-base py-3.5 mb-3 disabled:opacity-50 font-semibold rounded-xl transition-all ${
                membersOnly
                  ? 'bg-violet-600 hover:bg-violet-700 text-white'
                  : 'btn-primary'
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={loading ? 'loading' : isFull ? 'full' : 'join'}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.15 }}
                  className="block"
                >
                  {loading ? 'Joining…' :
                   isFull ? 'Join waitlist' :
                   membersOnly ? 'Attend' :
                   memberPrice !== undefined ? `Join — ${sym}${memberPrice} (member)` :
                   price === 0 ? 'Join free' :
                   `Buy ticket — ${sym}${price}`}
                </motion.span>
              </AnimatePresence>
            </motion.button>
              <button onClick={() => setShowStealth(s => !s)} title="Attend anonymously"
                className={`shrink-0 px-3 rounded-xl border transition-colors text-xs font-semibold ${
                  stealth ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-gray-200 text-gray-400 hover:border-gray-300'
                }`}>
                🕵️
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {confirmCancel && (
        // Belt-and-braces fix after the z-[70] version still hit the
        // same complaint:
        //   1. Inline style z-index instead of Tailwind arbitrary-value
        //      class — bypasses any JIT-compilation edge case where
        //      `z-[70]` might not be in the generated CSS, and bumps
        //      to 9999 so absolutely nothing in the app can sit above
        //      it (BottomNav z-50, Discover sheet z-[61], any future
        //      overlay).
        //   2. Anchor the wrapper to the TOP of the viewport on
        //      mobile (items-start pt-20). Even if all the z-index
        //      logic failed, the modal would physically sit in the
        //      upper third of the screen — nowhere near the bottom
        //      nav. Switches to items-center on sm+ so desktop keeps
        //      the centered look.
        //   3. Darker backdrop (bg-black/60) so it's unmistakeable
        //      that the page beneath is overlaid. Earlier report
        //      described the modal as looking inline because the
        //      bg-black/40 read as just "subtle off-tint".
        <div
          className="fixed inset-0 flex items-start sm:items-center justify-center p-4 pt-20 sm:pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-sm"
          style={{ zIndex: 9999 }}
          onClick={() => setConfirmCancel(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 text-lg mb-2">Cancel your spot?</h3>
            <p className="text-sm text-gray-500 mb-1">
              This event costs <strong>{sym}{price}</strong>. Cancelling now may forfeit your payment depending on the refund policy.
            </p>
            <p className="text-xs text-gray-400 mb-5">If you paid, contact the organiser to arrange a refund.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmCancel(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                Keep my spot
              </button>
              <button onClick={() => { setConfirmCancel(false); leave() }} disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {loading ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
