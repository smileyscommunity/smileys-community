'use client'

import { useState } from 'react'
import posthog from 'posthog-js'
import { toast } from 'sonner'

export default function MovingSaleContact({ saleId, firstName }: { saleId: string; firstName: string }) {
  const [open,    setOpen]    = useState(false)
  const [text,    setText]    = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    if (sending || !text.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/app/api/moving-sales/${saleId}/contact`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not send'); return }
      posthog.capture('moving_sale_contacted')
      toast.success('Message sent — replies land in your Messages')
      setOpen(false); setText('')
    } finally { setSending(false) }
  }

  return open ? (
    <div className="space-y-2">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={300}
        placeholder={`Hi ${firstName}, is the desk still available?`}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="px-4 py-2 text-xs font-bold text-gray-500">Cancel</button>
        <button onClick={send} disabled={sending || !text.trim()}
          className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors">
          {sending ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </div>
  ) : (
    <button onClick={() => setOpen(true)}
      className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-2xl transition-colors">
      💬 Contact {firstName}
    </button>
  )
}
