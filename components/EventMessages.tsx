'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

import { getInitials } from '@/lib/data'
import RichText from '@/components/RichText'

interface Message {
  id:        string
  message:   string
  createdAt: string
  user: { id: string; name: string; color: string }
}

export default function EventMessages({ eventId, eventDate }: { eventId: string; eventDate: string }) {
  const { user, isLoggedIn } = useAuth()

  // Discussion auto-locks 14 days post-event so dead-air messages don't
  // dilute the page and Reviews becomes the canonical post-event surface.
  // Server enforces the same window in the POST handler.
  const lockedAt   = new Date(eventDate); lockedAt.setDate(lockedAt.getDate() + 15) // start of day 15 = end of day 14
  const isLocked   = Date.now() >= lockedAt.getTime()
  const [messages,   setMessages]   = useState<Message[]>([])
  const [text,       setText]       = useState('')
  const [sending,    setSending]    = useState(false)
  const [initialised, setInitialised] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

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

  async function handleSend() {
    if (!text.trim() || sending) return
    setSending(true)
    const res  = await fetch(`/app/api/events/${eventId}/messages`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text.trim() }),
    })
    if (res.ok) {
      const msg = await res.json()
      setMessages(prev => [...prev, msg])
      setText('')
    }
    setSending(false)
  }

  async function handleDelete(messageId: string) {
    const res = await fetch(`/app/api/events/${eventId}/messages`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    })
    if (res.ok) setMessages(prev => prev.filter(m => m.id !== messageId))
  }

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
                </div>
                <p className="text-sm text-gray-700 mt-0.5 leading-relaxed whitespace-pre-wrap break-words"><RichText text={msg.message} /></p>
              </div>
              {(isOwn || isAdmin) && (
                <button
                  onClick={() => handleDelete(msg.id)}
                  className="text-gray-200 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0 text-lg leading-none mt-0.5"
                >
                  ×
                </button>
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
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Write a message…"
            className="flex-1 text-sm px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 text-gray-900"
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 transition-colors"
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
