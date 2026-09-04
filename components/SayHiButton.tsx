'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { firstNameOf } from '@/lib/data'

// "Say hi" to a member you're not connected to. This sends a connection
// REQUEST, not a message — the DM endpoint rejects unconnected senders
// (403 "You can only message connected members"), and the /visiting wave
// exception doesn't apply here: that one is scoped to people with an
// active visit post, which is what makes bypassing the guard defensible.
// Neighbours have made no such invitation, so they consent first.
export default function SayHiButton({ targetId, targetName }: { targetId: string; targetName: string }) {
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)

  async function send() {
    if (sending || sent) return
    setSending(true)
    try {
      const res = await fetch('/app/api/connections', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ receiverId: targetId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not send'); return }
      setSent(true)
      toast.success(`Request sent to ${firstNameOf(targetName)}!`)
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <span className="text-xs font-bold text-green-700 bg-green-100 px-2.5 py-1.5 rounded-full whitespace-nowrap">
        ✓ Sent
      </span>
    )
  }

  return (
    <button onClick={send} disabled={sending}
      className="text-xs font-bold px-3 py-1.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-60 transition-colors whitespace-nowrap">
      {sending ? '…' : '👋 Say hi'}
    </button>
  )
}
