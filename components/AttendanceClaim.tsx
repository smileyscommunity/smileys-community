'use client'

import { useState } from 'react'
import { toast } from 'sonner'

// "I was there", on the event page, for a guest the door didn't check in —
// shown during the morning-after review only (the server decides the window).

export default function AttendanceClaim({ eventId }: { eventId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

  async function claim() {
    setState('sending')
    try {
      const res = await fetch(`/app/api/events/${eventId}/attendance-claim`, { method: 'POST', credentials: 'include' })
      const d   = await res.json().catch(() => null)
      if (!res.ok) { toast.error(typeof d?.error === 'string' ? d.error : "Couldn't send that."); setState('idle'); return }
      setState('sent')
      toast.success(d?.already === 'checked_in' ? "You're already checked in." : 'Told the host. They can check you in until midnight.')
    } catch {
      toast.error('No connection — nothing was sent.')
      setState('idle')
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <span aria-hidden="true" className="text-xl leading-none">🎟️</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-amber-900">You weren&apos;t checked in</p>
        <p className="text-xs text-amber-800 mt-0.5">
          {state === 'sent'
            ? 'The host knows you were there and can check you in until midnight.'
            : 'If you came, tell the host now — they can still check you in today. After midnight it counts as a no-show.'}
        </p>
      </div>
      {state !== 'sent' && (
        <button onClick={claim} disabled={state === 'sending'}
          className="shrink-0 px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 disabled:opacity-50">
          {state === 'sending' ? 'Sending…' : 'I was there'}
        </button>
      )}
    </div>
  )
}
