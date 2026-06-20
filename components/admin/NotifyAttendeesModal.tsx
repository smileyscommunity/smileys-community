'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

// Lightweight modal over the existing /app/api/host/events/[id]/broadcast
// route — that route already handles auth, rate-limit, and per-attendee
// notification fanout. This UI only chooses what to send.
//
// Presets are short templates admins can one-tap and edit. Most cancel /
// venue-change messages share a structure ("we're sorry, here's why,
// here's what to do") — having the skeleton already in the box turns a
// 90-second compose into a 5-second confirm.

type Preset = {
  key:    string
  label:  string
  hint:   string
  body:   (title: string) => string
  accent: string // tailwind ring/text color for the chip
}

const PRESETS: Preset[] = [
  {
    key:    'cancelled',
    label:  'Cancelled',
    hint:   'Event is off — apologise and refund-promise',
    accent: 'text-red-400 ring-red-500/30 bg-red-500/10',
    body: t =>
      `Hi everyone — sadly we have to cancel "${t}". We're really sorry for the late notice. If you paid, your refund is being processed and you don't need to do anything. We'll see you at the next one. 💛`,
  },
  {
    key:    'venue_change',
    label:  'Venue change',
    hint:   'Same date, new place',
    accent: 'text-amber-400 ring-amber-500/30 bg-amber-500/10',
    body: t =>
      `Quick heads-up — "${t}" has a new venue. The date and time are unchanged. Please check the event page for the updated address and we'll see you there. 🙌`,
  },
  {
    key:    'time_change',
    label:  'Time change',
    hint:   'Same place, new time',
    accent: 'text-amber-400 ring-amber-500/30 bg-amber-500/10',
    body: t =>
      `Heads-up — "${t}" has a new time. Same venue, just a different start. Please double-check the event page so you don't miss it. 🙏`,
  },
  {
    key:    'reminder',
    label:  'Reminder',
    hint:   'Last-minute logistics nudge',
    accent: 'text-blue-400 ring-blue-500/30 bg-blue-500/10',
    body: t =>
      `Reminder — "${t}" is coming up! Please arrive on time, and message us if you can't make it so someone on the waitlist can take your spot. See you soon. ☀️`,
  },
]

interface Props {
  event:   { id: string; title: string; attendeeCount?: number } | null
  preset?: string
  onClose: () => void
}

export default function NotifyAttendeesModal({ event, preset, onClose }: Props) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  // Reset / pre-fill whenever the modal opens against a new event or
  // preset key. Without this, opening the modal a second time would
  // keep the previous draft visible.
  useEffect(() => {
    if (!event) return
    const p = PRESETS.find(p => p.key === preset)
    setMessage(p ? p.body(event.title) : '')
  }, [event, preset])

  if (!event) return null

  const chars = message.length
  const tooLong = chars > 500

  async function send() {
    if (!event) return
    if (!message.trim() || tooLong) return
    setSending(true)
    try {
      const res = await fetch(`/app/api/host/events/${event.id}/broadcast`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Failed to send')
        return
      }
      const { sent } = await res.json()
      toast.success(`Notified ${sent ?? 0} attendee${sent === 1 ? '' : 's'}`)
      onClose()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
         onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-zinc-800">
          <h2 className="text-white font-bold text-lg">Notify attendees</h2>
          <p className="text-zinc-500 text-sm mt-1 truncate">
            {event.title}
            {event.attendeeCount !== undefined && ` · ${event.attendeeCount} going`}
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
              Quick templates
            </label>
            <div className="flex gap-2 flex-wrap">
              {PRESETS.map(p => (
                <button key={p.key}
                  onClick={() => setMessage(p.body(event.title))}
                  title={p.hint}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold ring-1 transition-colors ${p.accent} hover:brightness-125`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Message
              </label>
              <span className={`text-xs font-mono ${tooLong ? 'text-red-400' : 'text-zinc-600'}`}>
                {chars}/500
              </span>
            </div>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={6}
              placeholder="Type your message to attendees…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm leading-relaxed resize-none focus:outline-none focus:border-amber-500"
            />
            <p className="text-xs text-zinc-600 mt-2">
              Sends as an in-app notification + deep-links to the event page. Approved attendees only.
            </p>
          </div>
        </div>

        <div className="p-5 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose}
            disabled={sending}
            className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white text-sm font-semibold transition-colors disabled:opacity-50">
            Close
          </button>
          <button onClick={send}
            disabled={sending || !message.trim() || tooLong}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black text-sm font-bold transition-colors disabled:opacity-40">
            {sending ? 'Sending…' : 'Send to attendees'}
          </button>
        </div>
      </div>
    </div>
  )
}
