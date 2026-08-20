'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { resolveImageUrl } from '@/lib/data'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_TZ } from '@/lib/cityTime'

interface Msg {
  id: string
  body: string
  createdAt: string | Date
  user: { id: string; name: string; color: string; profilePhoto: string | null }
}

// Interactive discussion for a hangout. Chat is host+joiner-only (the API
// gates read + post), so non-members see the thread read-only with a nudge to
// join; members get a composer and live refresh.
export default function HangoutDiscussion({ hangoutId, initialMessages, canPost, isJoinable }: {
  hangoutId: string
  initialMessages: Msg[]
  canPost: boolean
  isJoinable: boolean
}) {
  // Times belong to the city the content is in, not the reader's device.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ
  const [messages, setMessages] = useState<Msg[]>(initialMessages)
  const [draft,    setDraft]    = useState('')
  const [sending,  setSending]  = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Poll for new messages — only members may GET (others would 403), so gate
  // the poll on canPost.
  useEffect(() => {
    if (!canPost) return
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/app/api/hangouts/${hangoutId}/messages`, { credentials: 'include' })
        if (!res.ok) return
        const d = await res.json()
        if (Array.isArray(d.messages)) setMessages(d.messages)
      } catch { /* transient — next tick retries */ }
    }, 6000)
    return () => clearInterval(t)
  }, [hangoutId, canPost])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/app/api/hangouts/${hangoutId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? 'Could not send')
        return
      }
      const d = await res.json()
      setMessages(prev => [...prev, d.message])
      setDraft('')
    } catch {
      toast.error('Network error — try again')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
      <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">Discussion</p>

      {messages.length === 0 ? (
        <p className="text-sm text-gray-400 py-1">No messages yet{canPost ? ' — start the conversation.' : '.'}</p>
      ) : (
        <div className="space-y-3">
          {messages.map(m => {
            const av = m.user.profilePhoto ? resolveImageUrl(m.user.profilePhoto) : null
            return (
              <div key={m.id} className="flex items-start gap-2.5">
                {av
                  ? <img src={av} alt={m.user.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                  : <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                      style={{ backgroundColor: m.user.color }}>{m.user.name[0]}</div>}
                <div className="flex-1 min-w-0">
                  <p className="text-xs">
                    <span className="font-semibold text-gray-900">{m.user.name}</span>
                    <span className="text-gray-400"> · {new Date(m.createdAt).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{m.body}</p>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {isJoinable && (canPost ? (
        <form onSubmit={send} className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
          <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={1000}
            placeholder="Say something…" className="flex-1 input text-sm" />
          <button type="submit" disabled={sending || !draft.trim()}
            className="text-xs font-bold bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white px-4 py-2 rounded-xl shrink-0">
            Send
          </button>
        </form>
      ) : (
        <p className="text-xs text-gray-500 mt-4 pt-3 border-t border-gray-100">
          Tap <span className="font-semibold text-amber-700">I&apos;m in</span> above to join the discussion.
        </p>
      ))}
    </div>
  )
}
