'use client'

import { useState, useRef, useEffect } from 'react'
import { todayInTz, DEFAULT_TZ, discussionLockDay } from '@/lib/cityTime'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

import { getInitials } from '@/lib/data'
import RichText from '@/components/RichText'
import { toast } from 'sonner'

// The server's cap, in app/api/events/[id]/messages/route.ts. Kept here so the
// composer can say what the limit is before a member hits it: a paste longer
// than this was rejected with a 400 that nothing surfaced — the text sat in the
// box, Send appeared to do nothing, and no message arrived. Deliberately NOT a
// maxLength on the textarea, which would silently swallow the overflow instead
// of telling anyone it had.
const MESSAGE_MAX = 2000

interface Message {
  id:        string
  message:   string
  createdAt: string
  editedAt?: string | null
  user: { id: string; name: string; color: string }
}

export default function EventMessages({ eventId, eventDate, eventTz }: { eventId: string; eventDate: string; eventTz?: string }) {
  const { user, isLoggedIn } = useAuth()

  // Discussion auto-locks 14 days post-event so dead-air messages don't
  // dilute the page and Reviews becomes the canonical post-event surface.
  // Same rule and same clock as the server guards (discussionLockDay on the
  // event city's calendar) — the browser-local version here disagreed with
  // them by hours, leaving a composer whose every send failed.
  const isLocked   = todayInTz(eventTz ?? DEFAULT_TZ) >= discussionLockDay(eventDate)
  const [messages,   setMessages]   = useState<Message[]>([])
  const [text,       setText]       = useState('')
  const [sending,    setSending]    = useState(false)
  const [initialised, setInitialised] = useState(false)
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [editDraft,  setEditDraft]  = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/app/api/events/${eventId}/messages`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setMessages(Array.isArray(d) ? d : []); setInitialised(true) })
      .catch(() => {})
  }, [eventId])

  // Only scroll to bottom when a new message is added after initial load
  useEffect(() => {
    if (!initialised || messages.length === 0) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // The composer starts one line tall and grows with its content, to a cap.
  // Without this a pasted paragraph would sit in a one-line window with the
  // rest of it scrolled out of sight.
  function autoGrow() {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  async function handleSend() {
    if (!text.trim() || sending) return
    // Say so here rather than spending a round-trip on a 400.
    if (text.trim().length > MESSAGE_MAX) {
      toast.error(`Message is ${text.trim().length - MESSAGE_MAX} characters over the ${MESSAGE_MAX} limit`)
      return
    }
    setSending(true)
    try {
      const res  = await fetch(`/app/api/events/${eventId}/messages`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? 'Could not send')
        return
      }
      const msg = await res.json()
      setMessages(prev => [...prev, msg])
      setText('')
      // Back to one line, or the box keeps the height of what was just sent.
      if (composerRef.current) composerRef.current.style.height = 'auto'
    } catch {
      // Without this the throw left sending=true and the composer dead.
      toast.error('Network error — try again')
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(messageId: string) {
    const res = await fetch(`/app/api/events/${eventId}/messages`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    })
    if (res.ok) setMessages(prev => prev.filter(m => m.id !== messageId))
  }

  function startEdit(msg: Message) {
    setEditingId(msg.id)
    setEditDraft(msg.message)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft('')
  }

  async function handleSaveEdit(messageId: string) {
    if (!editDraft.trim() || savingEdit) return
    if (editDraft.trim().length > MESSAGE_MAX) {
      toast.error(`Message is ${editDraft.trim().length - MESSAGE_MAX} characters over the ${MESSAGE_MAX} limit`)
      return
    }
    setSavingEdit(true)
    try {
      const res = await fetch(`/app/api/events/${eventId}/messages`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, message: editDraft.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? 'Could not save')
        return
      }
      const updated = await res.json()
      setMessages(prev => prev.map(m => (m.id === messageId ? updated : m)))
      cancelEdit()
    } catch {
      toast.error('Network error — try again')
    } finally {
      setSavingEdit(false)
    }
  }

  const left    = MESSAGE_MAX - text.trim().length
  const tooLong = left < 0

  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-bold text-gray-900">Discussion ({messages.length})</h2>
        <p className="text-xs text-gray-400 mt-0.5">Chat with attendees{isLocked ? ' · closed' : ''}</p>
      </div>

      <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
        {messages.length === 0 && (
          <p className="px-5 py-6 text-sm text-gray-400 text-center">No messages yet. Be the first!</p>
        )}
        {messages.map(msg => {
          const isOwn  = msg.user.id === user?.id
          const isAdmin = user?.role === 'admin'
          return (
            <div key={msg.id} className="flex items-start gap-3 px-5 py-3 group">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5"
                style={{ backgroundColor: msg.user.color }}>
                {getInitials(msg.user.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-900">{msg.user.name}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(msg.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    {' '}
                    {new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {msg.editedAt && <span className="text-xs text-gray-300 italic">(edited)</span>}
                </div>
                {editingId === msg.id ? (
                  <div className="mt-1.5 flex flex-col gap-2">
                    <textarea
                      value={editDraft}
                      onChange={e => setEditDraft(e.target.value)}
                      rows={2}
                      autoFocus
                      className="w-full text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 text-gray-900 resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveEdit(msg.id)}
                        disabled={!editDraft.trim() || savingEdit}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors"
                      >
                        {savingEdit ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={savingEdit}
                        className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-700 mt-0.5 leading-relaxed whitespace-pre-wrap break-words"><RichText text={msg.message} /></p>
                )}
              </div>
              {/* Touch screens have no hover — controls must be visible on
                  mobile, hover-revealed only on md+ pointers. */}
              {(isOwn || isAdmin) && editingId !== msg.id && (
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  {isOwn && !isLocked && (
                    <button
                      onClick={() => startEdit(msg)}
                      title="Edit"
                      className="text-gray-300 hover:text-amber-500 transition-colors text-sm leading-none"
                    >
                      ✎
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(msg.id)}
                    title="Delete"
                    className="text-gray-200 hover:text-red-400 transition-colors text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {isLocked ? (
        <div className="px-5 py-4 border-t border-gray-100 text-center text-sm text-gray-400">
          Discussion closed — leave a <span className="font-semibold text-gray-600">Review</span> above instead.
        </div>
      ) : isLoggedIn ? (
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 items-end">
          {/* A textarea, not an <input type="text">. A single-line input cannot
              hold a newline at all, so text written elsewhere and pasted in
              arrived flattened — every paragraph break gone, and nothing to
              show the member it had happened. Storage keeps newlines (the API
              only trims) and the message above renders with whitespace-pre-wrap,
              so the composer was the one lossy step in the chain. The edit box
              below was already a textarea, which is why a message could be
              edited into paragraphs but never written as them.
              Enter still sends; Shift+Enter makes a new line, which is what the
              old !e.shiftKey check was always reaching for. */}
          <div className="flex-1">
            <textarea
              ref={composerRef}
              rows={1}
              value={text}
              onChange={e => { setText(e.target.value); autoGrow() }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
              }}
              placeholder="Write a message…"
              className={`w-full text-sm px-3 py-2.5 border rounded-xl focus:outline-none focus:ring-2 text-gray-900 resize-none leading-relaxed ${
                tooLong ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-amber-400'
              }`}
            />
            {/* Silent until it is nearly relevant, so a one-line message is not
                nagged at — then it counts down, then it turns red. */}
            {left <= 200 && (
              <p className={`text-xs mt-1 ${tooLong ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                {tooLong ? `${-left} characters over the limit` : `${left} characters left`}
              </p>
            )}
          </div>
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending || tooLong}
            className="px-4 py-2.5 shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 transition-colors"
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      ) : (
        <div className="px-5 py-4 border-t border-gray-100 text-center text-sm text-gray-400">
          <Link href="/login" className="text-amber-600 font-semibold hover:underline">Sign in</Link> to join the discussion
        </div>
      )}
    </div>
  )
}
