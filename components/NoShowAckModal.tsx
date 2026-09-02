'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NO_SHOW_CANCELLATION_CUTOFF_HOURS, RED_CARD_BLOCK_DAYS } from '@/lib/noShowPolicy'

// The yellow card's "I'll actually come" moment, as a real dialog rather
// than a toast strip. Rendered through a portal to document.body for the
// same reason as the cancel-confirmation in RSVPButton: on the event page
// the button lives in a sticky bar with backdrop-blur, which would trap a
// `fixed` overlay inside a 60px strip. Factual copy, two clear choices.

export default function NoShowAckModal({ open, onConfirm, onCancel, busy = false }: {
  open:      boolean
  onConfirm: () => void
  onCancel:  () => void
  busy?:     boolean
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!open || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-sm"
      style={{ zIndex: 9999 }}
      role="dialog" aria-modal="true" aria-labelledby="noshow-ack-title"
      onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="text-3xl mb-3" aria-hidden="true">🟨</div>
        <h3 id="noshow-ack-title" className="font-bold text-gray-900 text-lg mb-2">Before you join</h3>
        <p className="text-sm text-gray-600 mb-2">
          You had a spot at a recent event and weren&apos;t there. No problem — but spots at free events are limited, and someone on the waitlist could have had yours.
        </p>
        <p className="text-sm text-gray-600 mb-5">
          If plans change, cancelling at least <strong>{NO_SHOW_CANCELLATION_CUTOFF_HOURS} hours</strong> ahead keeps you clear. A second no-show pauses RSVPs for {RED_CARD_BLOCK_DAYS} days.
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
            Not this time
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {busy ? 'Joining…' : "I'll actually come"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
